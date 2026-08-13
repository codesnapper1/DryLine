"""JSON-file session persistence — no database, by design. Each session is
one JSON file under store/sessions/<id>.json holding its config, filter
state, hysteresis state, and full frame history.
"""

import json
import time
import uuid
from pathlib import Path
from typing import Any

STORE_DIR = Path(__file__).parent / "store" / "sessions"
STORE_DIR.mkdir(parents=True, exist_ok=True)


def _path(session_id: str) -> Path:
    return STORE_DIR / f"{session_id}.json"


def create_session(config: dict[str, Any]) -> dict[str, Any]:
    session_id = uuid.uuid4().hex[:12]
    session = {
        "id": session_id,
        "created_at": time.time(),
        "config": config,
        "filter_state": {},
        "hysteresis": {"label": None, "change_t": None},
        "frames": [],
    }
    save_session(session)
    return session


def load_session(session_id: str) -> dict[str, Any]:
    path = _path(session_id)
    if not path.exists():
        # Fallback to precomputed demo datasets
        demo_path = Path(__file__).parent.parent / "demo" / "precomputed" / f"{session_id}.json"
        if not demo_path.exists():
            raise FileNotFoundError(session_id)
        # Precomputed files only have "id" and "frames", we need to wrap them in a full session dict for the backend to use them
        data = json.loads(demo_path.read_text())
        if "config" not in data:
            data["config"] = {}
        if "filter_state" not in data:
            data["filter_state"] = {}
        if "hysteresis" not in data:
            data["hysteresis"] = {"label": None, "change_t": None}
        return data
    return json.loads(path.read_text())


def save_session(session: dict[str, Any]) -> None:
    _path(session["id"]).write_text(json.dumps(session, indent=2))


def calibrate_roi(session_id: str, line: tuple[float, float, float, float], off_line: tuple[float, float, float, float]) -> None:
    session = load_session(session_id)
    session["config"]["roi_boxes"] = {"line": line, "off_line": off_line}
    save_session(session)
