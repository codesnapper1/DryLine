from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional
import numpy as np


@dataclass
class Sample:
    timestamp: float
    wetness: float
    rate_per_min: float
    condition: str
    confidence: float


@dataclass
class SessionState:
    filtered_wetness: Optional[float] = None
    filtered_rate_per_sec: float = 0.0
    last_valid_timestamp: Optional[float] = None
    last_condition: str = "UNKNOWN"
    last_observation = None
    previous_gray: Optional[np.ndarray] = None
    trend: list[Sample] = field(default_factory=list)
    rejected_frames: int = 0


SESSIONS: dict[str, SessionState] = {}


def get_session(session_id: str) -> SessionState:
    if session_id not in SESSIONS:
        SESSIONS[session_id] = SessionState()
    return SESSIONS[session_id]
