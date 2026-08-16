"""Per-session state for the DryLine-upgraded strategy engine.

Separate in-memory store from the existing store.py JSON sessions.
"""
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
class StrategySessionState:
    filtered_wetness: Optional[float] = None
    filtered_rate_per_sec: float = 0.0
    last_valid_timestamp: Optional[float] = None
    last_condition: str = "UNKNOWN"
    last_observation: object = None
    previous_gray: Optional[np.ndarray] = None
    trend: list = field(default_factory=list)
    rejected_frames: int = 0


STRATEGY_SESSIONS: dict[str, StrategySessionState] = {}


def get_strategy_session(session_id: str) -> StrategySessionState:
    if session_id not in STRATEGY_SESSIONS:
        STRATEGY_SESSIONS[session_id] = StrategySessionState()
    return STRATEGY_SESSIONS[session_id]
