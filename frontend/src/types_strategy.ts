// TypeScript types for the DryLine-upgraded strategy engine API responses.
// These mirror the Pydantic models in backend/strategy_models.py.

export type TyreCompound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";

export type StrategyAction =
  | "STAY_OUT"
  | "PREPARE"
  | "PIT"
  | "STRATEGIC_HOLD"
  | "HOLD_DECISION"
  | "NO_DECISION";

export type TrackConditionV2 =
  | "UNKNOWN"
  | "DRY"
  | "DAMP"
  | "WET"
  | "DRYING"
  | "WETTING";

export type SystemStatusV2 = "HEALTHY" | "DEGRADED" | "STALE" | "LOST";

export interface TyreState {
  compound: TyreCompound;
  health: number; // 0..1
  age_laps: number;
  temperature_c?: number | null;
  changes_remaining: number;
  pit_loss_seconds: number;
}

export interface WeatherStateV2 {
  rain_intensity?: number | null;
  rain_expected_minutes?: number | null;
  confidence: number;
}

export interface VisionObservation {
  wetness: number;
  racing_line_wetness?: number | null;
  offline_wetness?: number | null;
  standing_water?: number;
  spray?: number;
  rain_intensity?: number;
  vision_confidence?: number;
  frame_quality?: number;
  track_visible?: boolean;
  timestamp: number;
  notes?: string[];
}

export interface TyreScore {
  compound: TyreCompound;
  compatibility: number;
  health_adjusted_score: number;
  strategic_score: number;
}

export interface StrategyResult {
  action: StrategyAction;
  recommended_tyre: TyreCompound;
  current_tyre: TyreCompound;
  current_compatibility: number;
  recommended_compatibility: number;
  crossover_laps: [number, number] | null;
  strategy_confidence: number;
  risk_score: number;
  reasons: string[];
  scores: TyreScore[];
}

export interface SystemHealthV2 {
  status: SystemStatusV2;
  data_confidence: number;
  frame_age_seconds: number;
  sensor_agreement: number;
  warnings: string[];
}

export interface TrendSample {
  timestamp: number;
  wetness: number;
  rate_per_min: number;
  condition: string;
  confidence: number;
}

export interface AnalysisResult {
  session_id: string;
  condition: TrackConditionV2;
  raw_wetness: number;
  filtered_wetness: number;
  wetness_rate_per_min: number;
  racing_line_wetness: number | null;
  offline_wetness: number | null;
  whiplash: boolean;
  whiplash_message: string | null;
  vision_confidence: number;
  strategy: StrategyResult;
  system: SystemHealthV2;
  accepted_frame: boolean;
  rejection_reasons: string[];
  trend: TrendSample[];
}

export interface IngestRequest {
  session_id: string;
  observation: VisionObservation;
  tyre: TyreState;
  weather?: WeatherStateV2 | null;
  lap_time_seconds: number;
}
