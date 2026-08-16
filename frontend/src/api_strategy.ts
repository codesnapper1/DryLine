// API helpers for the DryLine-upgraded strategy engine endpoints.
import { API_BASE } from "./api";
import type { AnalysisResult, IngestRequest, TyreState, WeatherStateV2 } from "./types_strategy";

/**
 * POST /api/ingest-observation
 * Send a structured observation (wetness, tyre, weather) and get back
 * a full tyre strategy decision.
 */
export async function ingestObservation(
  req: IngestRequest
): Promise<AnalysisResult> {
  const res = await fetch(`${API_BASE}/api/ingest-observation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`ingestObservation failed: ${res.status}`);
  return res.json();
}

/**
 * POST /api/analyze-frame
 * Upload a track camera image with tyre + weather context and get back
 * a full strategy decision (with frame quality gate applied).
 */
export async function analyzeFrame(
  file: File | Blob,
  sessionId: string,
  tyre: TyreState,
  weather: WeatherStateV2 | null,
  lapTimeSeconds = 90.0
): Promise<AnalysisResult> {
  const fd = new FormData();
  fd.append("file", file, "frame.jpg");
  fd.append("session_id", sessionId);
  fd.append("tyre_json", JSON.stringify(tyre));
  fd.append("weather_json", weather ? JSON.stringify(weather) : "{}");
  fd.append("lap_time_seconds", String(lapTimeSeconds));

  const res = await fetch(`${API_BASE}/api/analyze-frame`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(`analyzeFrame failed: ${res.status}`);
  return res.json();
}

/**
 * POST /api/reset-v2/{sessionId}
 * Reset the strategy engine session state.
 */
export async function resetStrategy(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/api/reset-v2/${sessionId}`, { method: "POST" });
}

/**
 * Build the demo rain sequence payload — simulates a wetting track over 6 steps.
 */
export function buildDemoPayload(
  sessionId: string,
  step: number,
  tyre: TyreState,
  weather: WeatherStateV2 | null
): IngestRequest {
  const seq = [0.16, 0.21, 0.29, 0.38, 0.52, 0.61];
  const w = seq[step % seq.length];
  const now = Date.now() / 1000 + step * 8;
  return {
    session_id: sessionId,
    observation: {
      wetness: w,
      racing_line_wetness: Math.max(0.05, w - 0.12),
      offline_wetness: Math.min(1, w + 0.16),
      standing_water: Math.max(0, (w - 0.35) * 0.9),
      spray: Math.max(0, (w - 0.3) * 0.7),
      rain_intensity: Math.min(1, w + 0.15),
      vision_confidence: 0.92,
      frame_quality: 0.94,
      track_visible: true,
      timestamp: now,
      notes: ["structured demo observation"],
    },
    tyre,
    weather: weather ?? { rain_intensity: Math.min(1, w + 0.12), rain_expected_minutes: 4, confidence: 0.85 },
    lap_time_seconds: 90,
  };
}
