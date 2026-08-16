from __future__ import annotations

from enum import Enum
from typing import List, Optional, Tuple
from pydantic import BaseModel, Field


class TrackCondition(str, Enum):
    UNKNOWN = "UNKNOWN"
    DRY = "DRY"
    DAMP = "DAMP"
    WET = "WET"
    DRYING = "DRYING"
    WETTING = "WETTING"


class TyreCompound(str, Enum):
    SOFT = "SOFT"
    MEDIUM = "MEDIUM"
    HARD = "HARD"
    INTERMEDIATE = "INTERMEDIATE"
    WET = "WET"


class StrategyAction(str, Enum):
    STAY_OUT = "STAY_OUT"
    PREPARE = "PREPARE"
    PIT = "PIT"
    STRATEGIC_HOLD = "STRATEGIC_HOLD"
    HOLD_DECISION = "HOLD_DECISION"
    NO_DECISION = "NO_DECISION"


class SystemStatus(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    STALE = "STALE"
    LOST = "LOST"


class VisionObservation(BaseModel):
    wetness: float = Field(ge=0, le=1)
    racing_line_wetness: Optional[float] = Field(default=None, ge=0, le=1)
    offline_wetness: Optional[float] = Field(default=None, ge=0, le=1)
    standing_water: float = Field(default=0, ge=0, le=1)
    spray: float = Field(default=0, ge=0, le=1)
    rain_intensity: float = Field(default=0, ge=0, le=1)
    vision_confidence: float = Field(default=0.7, ge=0, le=1)
    frame_quality: float = Field(default=1.0, ge=0, le=1)
    track_visible: bool = True
    timestamp: float
    notes: List[str] = []


class TyreState(BaseModel):
    compound: TyreCompound = TyreCompound.MEDIUM
    health: float = Field(default=0.9, ge=0, le=1)
    age_laps: int = Field(default=0, ge=0)
    temperature_c: Optional[float] = None
    changes_remaining: int = Field(default=3, ge=0)
    pit_loss_seconds: float = Field(default=21.0, ge=0)


class WeatherState(BaseModel):
    rain_intensity: Optional[float] = Field(default=None, ge=0, le=1)
    rain_expected_minutes: Optional[float] = Field(default=None, ge=0)
    confidence: float = Field(default=0.5, ge=0, le=1)


class IngestRequest(BaseModel):
    session_id: str = "default"
    observation: VisionObservation
    tyre: TyreState = TyreState()
    weather: Optional[WeatherState] = None
    lap_time_seconds: float = Field(default=90.0, gt=20)


class QualityMetrics(BaseModel):
    quality: float
    blur_score: float
    exposure_score: float
    frozen_score: float
    accepted: bool
    reasons: List[str] = []


class TyreScore(BaseModel):
    compound: TyreCompound
    compatibility: float
    health_adjusted_score: float
    strategic_score: float


class StrategyResult(BaseModel):
    action: StrategyAction
    recommended_tyre: TyreCompound
    current_tyre: TyreCompound
    current_compatibility: float
    recommended_compatibility: float
    crossover_laps: Optional[Tuple[float, float]] = None
    strategy_confidence: float
    risk_score: int
    reasons: List[str]
    scores: List[TyreScore]


class SystemHealth(BaseModel):
    status: SystemStatus
    data_confidence: float
    frame_age_seconds: float
    sensor_agreement: float
    warnings: List[str]


class AnalysisResult(BaseModel):
    session_id: str
    condition: TrackCondition
    raw_wetness: float
    filtered_wetness: float
    wetness_rate_per_min: float
    racing_line_wetness: Optional[float] = None
    offline_wetness: Optional[float] = None
    whiplash: bool
    whiplash_message: Optional[str] = None
    vision_confidence: float
    strategy: StrategyResult
    system: SystemHealth
    accepted_frame: bool
    rejection_reasons: List[str] = []
    trend: List[dict]
