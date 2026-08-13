"""Dataset builder: saves on-track (line) and off-track (off_line) ROI crop
images to disk as JPEG files, paired with a labels.csv that records the
per-frame wetness values, final rendered label, and VLM evidence fields.

Directory layout (inside backend/store/datasets/<session_id>/):
    line/
        <session_id>_t<t_ms>_line.jpg
    off_line/
        <session_id>_t<t_ms>_off_line.jpg
    labels.csv

The CSV schema matches the CSV export in main.py but adds image paths so the
dataset is self-contained and ready for supervised learning or reference-frame
curation.
"""

import csv
import io
import zipfile
from pathlib import Path

import cv2
import numpy as np

DATASET_DIR = Path(__file__).parent / "store" / "datasets"
DATASET_DIR.mkdir(parents=True, exist_ok=True)

CSV_FIELDS = [
    "session_id",
    "t",
    "displayed_label",
    "w_line",
    "w_off_line",
    "rate_line_per_min",
    "rate_off_line_per_min",
    "divergence",
    "confidence_ok",
    "model_confidence",
    "provider",
    # VLM evidence — on-track (A)
    "line_surface_gloss",
    "line_standing_water",
    "line_reflections_visible",
    "line_spray_from_cars",
    "line_dry_patches_forming",
    "line_wetness_0_100",
    "line_confidence_0_100",
    # VLM evidence — off-track (B)
    "off_line_surface_gloss",
    "off_line_standing_water",
    "off_line_reflections_visible",
    "off_line_spray_from_cars",
    "off_line_dry_patches_forming",
    "off_line_wetness_0_100",
    "off_line_confidence_0_100",
    # Image paths (relative to dataset root)
    "line_image",
    "off_line_image",
]


def _session_dir(session_id: str) -> Path:
    d = DATASET_DIR / session_id
    (d / "line").mkdir(parents=True, exist_ok=True)
    (d / "off_line").mkdir(parents=True, exist_ok=True)
    return d


def save_crops(
    session_id: str,
    t: float,
    rois: dict[str, dict],  # {name: {"crop": ndarray, "stats": {...}}}
    frame_record: dict,
) -> dict[str, str]:
    """Save on-track and off-track ROI crops as JPEGs; append a row to labels.csv.
    Returns {"line": rel_path, "off_line": rel_path}.
    """
    d = _session_dir(session_id)
    t_ms = int(round(t * 1000))
    paths: dict[str, str] = {}

    for roi_name, roi_data in rois.items():
        crop: np.ndarray = roi_data["crop"]
        filename = f"{session_id}_t{t_ms}_{roi_name}.jpg"
        rel_path = f"{roi_name}/{filename}"
        abs_path = d / roi_name / filename
        cv2.imwrite(str(abs_path), crop, [cv2.IMWRITE_JPEG_QUALITY, 92])
        paths[roi_name] = rel_path

    _append_csv_row(d, session_id, t, frame_record, paths)
    return paths


def _ev(frame_record: dict, roi_name: str, field: str):
    """Safely pull a field from the VLM evidence dict (may be None for stub runs)."""
    ev = frame_record.get("evidence") or {}
    region_ev = ev.get(roi_name)
    if region_ev is None:
        return ""
    return region_ev.get(field, "")


def _append_csv_row(
    d: Path,
    session_id: str,
    t: float,
    frame_record: dict,
    paths: dict[str, str],
) -> None:
    csv_path = d / "labels.csv"
    write_header = not csv_path.exists()
    with csv_path.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        if write_header:
            writer.writeheader()
        writer.writerow(
            {
                "session_id": session_id,
                "t": round(t, 3),
                "displayed_label": frame_record.get("displayed_label", ""),
                "w_line": round(frame_record.get("w_line", 0), 4),
                "w_off_line": round(frame_record.get("w_off_line", 0), 4),
                "rate_line_per_min": round(frame_record.get("rate_line_per_min", 0), 5),
                "rate_off_line_per_min": round(frame_record.get("rate_off_line_per_min", 0), 5),
                "divergence": round(frame_record.get("divergence", 0), 4),
                "confidence_ok": frame_record.get("confidence_ok", ""),
                "model_confidence": round(frame_record.get("model_confidence", 0), 4),
                "provider": frame_record.get("provider", "stub"),
                # On-track evidence (A)
                "line_surface_gloss": _ev(frame_record, "line", "surface_gloss"),
                "line_standing_water": _ev(frame_record, "line", "standing_water"),
                "line_reflections_visible": _ev(frame_record, "line", "reflections_visible"),
                "line_spray_from_cars": _ev(frame_record, "line", "spray_from_cars"),
                "line_dry_patches_forming": _ev(frame_record, "line", "dry_patches_forming"),
                "line_wetness_0_100": _ev(frame_record, "line", "wetness_0_100"),
                "line_confidence_0_100": _ev(frame_record, "line", "confidence_0_100"),
                # Off-track evidence (B)
                "off_line_surface_gloss": _ev(frame_record, "off_line", "surface_gloss"),
                "off_line_standing_water": _ev(frame_record, "off_line", "standing_water"),
                "off_line_reflections_visible": _ev(frame_record, "off_line", "reflections_visible"),
                "off_line_spray_from_cars": _ev(frame_record, "off_line", "spray_from_cars"),
                "off_line_dry_patches_forming": _ev(frame_record, "off_line", "dry_patches_forming"),
                "off_line_wetness_0_100": _ev(frame_record, "off_line", "wetness_0_100"),
                "off_line_confidence_0_100": _ev(frame_record, "off_line", "confidence_0_100"),
                # Image relative paths
                "line_image": paths.get("line", ""),
                "off_line_image": paths.get("off_line", ""),
            }
        )


def dataset_exists(session_id: str) -> bool:
    return (DATASET_DIR / session_id / "labels.csv").exists()


def build_zip(session_id: str) -> bytes:
    """Pack the entire dataset folder for a session into an in-memory ZIP
    and return the raw bytes. Raises FileNotFoundError if no dataset exists yet.
    """
    d = DATASET_DIR / session_id
    csv_path = d / "labels.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"no dataset for session {session_id!r}")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(d.rglob("*")):
            if p.is_file():
                zf.write(p, p.relative_to(d))
    buf.seek(0)
    return buf.read()


def dataset_stats(session_id: str) -> dict:
    """Quick summary: total crops saved, label distribution."""
    d = DATASET_DIR / session_id
    csv_path = d / "labels.csv"
    if not csv_path.exists():
        return {"exists": False}

    line_crops = list((d / "line").glob("*.jpg"))
    off_crops = list((d / "off_line").glob("*.jpg"))

    label_counts: dict[str, int] = {}
    with csv_path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            lbl = row.get("displayed_label", "UNKNOWN")
            label_counts[lbl] = label_counts.get(lbl, 0) + 1

    return {
        "exists": True,
        "total_frames": len(line_crops),
        "line_crops": len(line_crops),
        "off_line_crops": len(off_crops),
        "label_distribution": label_counts,
    }
