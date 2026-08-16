from __future__ import annotations

import json
import time
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from decision import process_observation, rejected_result
from models import IngestRequest, TyreState, WeatherState
from quality import assess_image_quality
from state import get_session, SESSIONS
from vision_adapter import heuristic_observation

app = FastAPI(title="DryLine Strategy API", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "service": "dryline-strategy", "version": "2.0"}


@app.post("/api/ingest-observation")
def ingest(req: IngestRequest):
    state = get_session(req.session_id)
    return process_observation(
        req.session_id, state, req.observation,
        req.tyre, req.weather, req.lap_time_seconds,
    )


@app.post("/api/analyze-frame")
async def analyze_frame(
    file: UploadFile = File(...),
    session_id: str = Form("default"),
    tyre_json: str = Form("{}"),
    weather_json: str = Form("{}"),
    lap_time_seconds: float = Form(90.0),
):
    raw = await file.read()
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    state = get_session(session_id)
    tyre = TyreState(**json.loads(tyre_json or "{}"))
    weather_dict = json.loads(weather_json or "{}")
    weather: Optional[WeatherState] = WeatherState(**weather_dict) if weather_dict else None

    quality, gray = assess_image_quality(image, state.previous_gray)
    if gray.size:
        state.previous_gray = gray

    if not quality.accepted:
        return rejected_result(session_id, state, tyre, time.time(), quality.reasons)

    observation = heuristic_observation(image, quality.quality)
    # Keep the quality gate reasons as explainable evidence.
    observation.notes.extend(quality.reasons)
    return process_observation(
        session_id, state, observation, tyre, weather, lap_time_seconds,
    )


@app.post("/api/reset/{session_id}")
def reset_session(session_id: str):
    SESSIONS.pop(session_id, None)
    return {"ok": True, "session_id": session_id}


@app.get("/api/session/{session_id}")
def get_session_snapshot(session_id: str):
    state = get_session(session_id)
    age = None if state.last_valid_timestamp is None else max(0.0, time.time() - state.last_valid_timestamp)
    return {
        "session_id": session_id,
        "condition": state.last_condition,
        "filtered_wetness": state.filtered_wetness,
        "rate_per_min": state.filtered_rate_per_sec * 60,
        "last_valid_age_seconds": age,
        "rejected_frames": state.rejected_frames,
        "trend": [s.__dict__ for s in state.trend[-60:]],
    }
