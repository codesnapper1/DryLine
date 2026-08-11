export type Level = "dry" | "damp" | "wet" | "standing";
export type Trend = "drying" | "wetting" | "stable";
export type Label = "DRY" | "DAMP" | "WET" | "DRYING" | "LOW_CONFIDENCE";

export interface Crossover {
  target_compound: "intermediate" | "slick";
  target_w: number;
  eta_minutes: number;
  eta_laps: number;
}

export type Provider = "stub" | "gemini" | "groq" | "openrouter" | "cache" | "none";

// One region ("A"/"line" or "B"/"off_line") of a VLM evidence read — the raw
// fields prompts.py asks for, per CLAUDE.md section 4's JSON schema.
export interface EvidenceRegion {
  surface_gloss: "none" | "slight" | "moderate" | "mirror_like";
  reflections_visible: boolean;
  standing_water: "none" | "patches" | "continuous";
  spray_from_cars: "none" | "light" | "heavy" | "not_visible";
  dry_patches_forming: "none" | "emerging" | "dominant";
  wetness_0_100: number;
  confidence_0_100: number;
  note: string;
  occluded_or_unclear: boolean;
}

export interface DecisionFrame {
  t: number;
  level: Level;
  raw_label: Label;
  displayed_label: Label;
  trend: Trend;
  w_line: number;
  rate_line_per_min: number;
  w_off_line: number;
  rate_off_line_per_min: number;
  divergence: number;
  confidence_ok: boolean;
  confidence_reasons: string[];
  model_confidence: number;
  crossover: Crossover | null;
  suggestion: string;
  raw_w_line: number;
  raw_w_off_line: number;
  provider: Provider;
  evidence: Record<"line" | "off_line", EvidenceRegion | null>;
  quality: Record<"line" | "off_line", { laplacian_var: number; mean_luminance: number }>;
}

export type RoiBox = [number, number, number, number]; // x, y, w, h fractional

export interface SessionCreateResponse {
  id: string;
  created_at: number;
  config: Record<string, unknown>;
  roi_boxes: { line: RoiBox; off_line: RoiBox };
}

export interface ProviderStatus {
  name: "gemini" | "groq" | "openrouter";
  configured: boolean;
  forced: boolean;
  last_ok: number | null;
  last_error: string | null;
}

export interface SessionConfig {
  name?: string;
  lap_time_s?: number;
  initial_w?: number;
  drift_per_min?: number;
  sine_amp?: number;
  sine_period_s?: number;
  noise_std?: number;
  lag_s?: number;
  lat?: number;
  lon?: number;
}

export type WeatherAgreement = "agree" | "disagree" | "unknown";

export interface WeatherConditions {
  precipitation_mm: number;
  is_raining: boolean;
  minutes_since_rain: number | null;
  source: "live" | "cache";
  fetched_at: number;
}

export type WeatherResponse =
  | { available: true; conditions: WeatherConditions; agreement: WeatherAgreement }
  | { available: false; reason: string };
