"""FastAPI app: ingest -> roi -> vlm(stub) -> temporal filter -> decision
render, backed by JSON-file sessions (store.py). See CLAUDE.md and PLAN.md
Phase 1 for the contract this implements.

Run from inside backend/:
    uvicorn main:app --reload --port 8000
"""

import csv
import io
import tempfile
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

load_dotenv()  # populates os.environ from .env before vlm.py ever reads a provider key

import decision as decision_mod
import roi
import store
import summary as summary_mod
import temporal
import vlm
import weather

app = FastAPI(title="DRYLINE backend")

# Dev-only: frontend (Vite, localhost:5173) calls this API directly from the
# browser. No auth/production concerns here per CLAUDE.md non-goals.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SessionCreate(BaseModel):
    name: Optional[str] = None
    lap_time_s: float = 90.0
    roi_line: Optional[tuple[float, float, float, float]] = None
    roi_off_line: Optional[tuple[float, float, float, float]] = None
    fps_sample: float = 2.0
    # Fake-decider generator params (vlm.py stub) — override to script a
    # different arc (e.g. positive drift_per_min to demo "wetting").
    initial_w: float = 0.80
    drift_per_min: float = -0.045
    sine_amp: float = 0.02
    sine_period_s: float = 50.0
    noise_std: float = 0.01
    lag_s: float = 150.0
    # Optional — enables GET /session/{id}/weather's Open-Meteo cross-check.
    # No lat/lon means weather is simply unavailable for this session, not an error.
    lat: Optional[float] = None
    lon: Optional[float] = None


def _load_or_404(session_id: str) -> dict:
    try:
        return store.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(404, f"unknown session {session_id}")


def _decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "could not decode image")
    return img


def _roi_boxes(session: dict) -> dict[str, tuple]:
    cfg = session["config"]
    return {
        "line": tuple(cfg["roi_line"]) if cfg.get("roi_line") else roi.DEFAULT_ROI_LINE,
        "off_line": tuple(cfg["roi_off_line"]) if cfg.get("roi_off_line") else roi.DEFAULT_ROI_OFF_LINE,
    }


async def _ingest_frame(session: dict, img: np.ndarray, t: float, single_image: bool) -> dict:
    boxes = _roi_boxes(session)
    rois = roi.process_rois(img, boxes)

    confidence_reasons: list[str] = []
    for name, r in rois.items():
        confidence_reasons += roi.quality_reasons(name, r["stats"])

    preds = await vlm.predict(session["id"], t, rois, session["config"], single_image=single_image)
    model_confidence = sum(p["confidence"] for p in preds.values()) / len(preds)

    # Total provider outage (every provider in the chain failed): don't feed a
    # missing/garbage measurement into the filter — carry the last known
    # smoothed state forward untouched. See CLAUDE.md section 6: fail loud
    # (LOW_CONFIDENCE), never interpolate, never present stale state as live.
    provider_outage = any(p.get("provider") == "none" for p in preds.values())

    filter_states = session["filter_state"]
    filtered: dict[str, dict] = {}
    gap_exceeded_any = False
    for name in boxes:
        prev = filter_states.get(name)
        if prev:
            state = temporal.FilterState.from_dict(prev)
        else:
            # First frame ever for this ROI. If this also happens to be a
            # total provider outage there's no measurement to seed from —
            # fall back to 0.0 rather than crash; the LOW_CONFIDENCE label
            # this produces makes it obvious it's not a real reading.
            state = temporal.FilterState.initial(preds[name]["w"] if preds[name]["w"] is not None else 0.0)
        if provider_outage:
            filtered[name] = {"raw_w": state.x, "smoothed_w": state.x, "rate_per_min": state.v * 60.0}
            continue
        new_state, rate_per_min, gap_exceeded = temporal.update(state, preds[name]["w"], t)
        filter_states[name] = new_state.to_dict()
        gap_exceeded_any = gap_exceeded_any or gap_exceeded
        filtered[name] = {
            "raw_w": preds[name]["w"],
            "smoothed_w": new_state.x,
            "rate_per_min": rate_per_min,
        }

    if provider_outage:
        confidence_reasons.append("no_provider_available")
    else:
        if gap_exceeded_any:
            confidence_reasons.append("timestamp_gap")
        for name, p in preds.items():
            if p.get("occluded"):
                confidence_reasons.append(f"{name}_occluded")
            if p["confidence"] < vlm.MIN_MODEL_CONFIDENCE:
                confidence_reasons.append(f"{name}_low_model_confidence")
            if p.get("spread") is not None and p["spread"] > vlm.SELF_CONSISTENCY_SPREAD_MAX:
                confidence_reasons.append(f"{name}_self_consistency_spread")
    confidence_ok = len(confidence_reasons) == 0

    dec = decision_mod.build_decision(
        t=t,
        w_line=filtered["line"]["smoothed_w"],
        rate_line_per_min=filtered["line"]["rate_per_min"],
        w_off_line=filtered["off_line"]["smoothed_w"],
        rate_off_line_per_min=filtered["off_line"]["rate_per_min"],
        confidence_ok=confidence_ok,
        confidence_reasons=confidence_reasons,
        lap_time_s=session["config"]["lap_time_s"],
    )

    hyst = session["hysteresis"]
    displayed_label, change_t = temporal.apply_hysteresis(hyst["label"], hyst["change_t"], dec["raw_label"], t)
    hyst["label"], hyst["change_t"] = displayed_label, change_t

    frame_record = {
        **dec,
        "displayed_label": displayed_label,
        "raw_w_line": filtered["line"]["raw_w"],
        "raw_w_off_line": filtered["off_line"]["raw_w"],
        "model_confidence": model_confidence,
        "provider": preds["line"].get("provider", "stub"),
        "evidence": {name: preds[name].get("evidence") for name in preds},
        "quality": {name: rois[name]["stats"] for name in rois},
    }
    session["frames"].append(frame_record)
    return frame_record


@app.get("/health")
def health():
    return {"status": "ok"}


class ProviderSelect(BaseModel):
    provider: Optional[str] = None  # one of vlm.PROVIDER_ORDER, or None/"auto" to clear the override


@app.get("/providers")
def list_providers():
    return {"providers": vlm.get_provider_status(), "any_configured": vlm.any_provider_configured()}


@app.post("/providers/select")
def select_provider(body: ProviderSelect):
    try:
        vlm.select_provider(body.provider)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"providers": vlm.get_provider_status()}


@app.post("/session")
def create_session(body: SessionCreate):
    session = store.create_session(body.model_dump())
    return {
        "id": session["id"],
        "created_at": session["created_at"],
        "config": session["config"],
        "roi_boxes": _roi_boxes(session),
    }


@app.post("/session/{session_id}/frame")
async def post_frame(session_id: str, image: UploadFile = File(...), t: Optional[float] = Form(None)):
    session = _load_or_404(session_id)
    t_val = t if t is not None else time.time() - session["created_at"]
    img = _decode_image(await image.read())
    frame = await _ingest_frame(session, img, t_val, single_image=True)
    store.save_session(session)
    return frame


@app.post("/session/{session_id}/video")
async def post_video(
    session_id: str,
    video: UploadFile = File(...),
    fps_sample: Optional[float] = Form(None),
    t_start: Optional[float] = Form(None),
):
    session = _load_or_404(session_id)
    sample_rate = fps_sample or session["config"]["fps_sample"]
    t0 = t_start if t_start is not None else (time.time() - session["created_at"])

    data = await video.read()
    suffix = Path(video.filename or "clip.mp4").suffix or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            raise HTTPException(400, "could not decode video")
        native_fps = cap.get(cv2.CAP_PROP_FPS) or sample_rate
        frame_stride = max(1, round(native_fps / sample_rate))

        ingested: list[dict] = []
        idx = 0
        sampled = 0
        while True:
            ok, frame_img = cap.read()
            if not ok:
                break
            if idx % frame_stride == 0:
                t_val = t0 + sampled / sample_rate
                ingested.append(await _ingest_frame(session, frame_img, t_val, single_image=False))
                sampled += 1
            idx += 1
        cap.release()
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    store.save_session(session)
    return {
        "frames_ingested": len(ingested),
        "t_start": t0,
        "t_end": ingested[-1]["t"] if ingested else t0,
    }


@app.get("/session/{session_id}/series")
def get_series(session_id: str):
    session = _load_or_404(session_id)
    return {"id": session_id, "frames": session["frames"]}


@app.get("/session/{session_id}/decision")
def get_decision(session_id: str):
    session = _load_or_404(session_id)
    if not session["frames"]:
        raise HTTPException(404, "no frames ingested yet")
    latest = dict(session["frames"][-1])
    latest["displayed_label"] = session["hysteresis"]["label"]
    return latest


@app.get("/session/{session_id}/summary")
def get_summary(session_id: str):
    session = _load_or_404(session_id)
    return {"summary": summary_mod.build_summary(session["frames"])}


@app.get("/session/{session_id}/weather")
def get_weather(session_id: str):
    session = _load_or_404(session_id)
    lat, lon = session["config"].get("lat"), session["config"].get("lon")
    if lat is None or lon is None:
        return {"available": False, "reason": "no lat/lon configured for this session"}

    conditions = weather.get_conditions(lat, lon)
    if conditions is None:
        return {"available": False, "reason": "no live data and no cache available"}

    trend = session["frames"][-1]["trend"] if session["frames"] else None
    agreement = decision_mod.weather_agreement(trend, conditions) if trend else "unknown"
    return {"available": True, "conditions": conditions, "agreement": agreement}


CSV_FIELDS = [
    "t",
    "level",
    "raw_label",
    "displayed_label",
    "trend",
    "w_line",
    "rate_line_per_min",
    "w_off_line",
    "rate_off_line_per_min",
    "divergence",
    "confidence_ok",
    "confidence_reasons",
    "model_confidence",
    "provider",
    "suggestion",
    "crossover_target_compound",
    "crossover_eta_laps",
]


@app.get("/session/{session_id}/export.csv")
def export_csv(session_id: str):
    session = _load_or_404(session_id)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
    writer.writeheader()
    for f in session["frames"]:
        crossover = f.get("crossover") or {}
        writer.writerow(
            {
                "t": f["t"],
                "level": f["level"],
                "raw_label": f["raw_label"],
                "displayed_label": f["displayed_label"],
                "trend": f["trend"],
                "w_line": f["w_line"],
                "rate_line_per_min": f["rate_line_per_min"],
                "w_off_line": f["w_off_line"],
                "rate_off_line_per_min": f["rate_off_line_per_min"],
                "divergence": f["divergence"],
                "confidence_ok": f["confidence_ok"],
                "confidence_reasons": ";".join(f["confidence_reasons"]),
                "model_confidence": f["model_confidence"],
                "provider": f["provider"],
                "suggestion": f["suggestion"],
                "crossover_target_compound": crossover.get("target_compound", ""),
                "crossover_eta_laps": crossover.get("eta_laps", ""),
            }
        )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{session_id}.csv"'},
    )
