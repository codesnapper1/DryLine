/**
 * StrategyEngine — DryLine-Upgraded integration component.
 *
 * Renders the full tyre strategy panel, system health, tyre controls,
 * and live wetness trend from the new /api/* endpoints. Designed to be
 * embedded inside the existing Strategy Hub view in App.tsx.
 */
import { useState, useCallback } from "react";
import type { AnalysisResult, TyreState, WeatherStateV2 } from "../types_strategy";
import { ingestObservation, buildDemoPayload, resetStrategy } from "../api_strategy";

// ── Tiny helpers ──────────────────────────────────────────────────────────────

const ACTION_COLOR: Record<string, string> = {
  STAY_OUT: "#22d3a6",
  PREPARE: "#f0d466",
  PIT: "#ff6e6e",
  STRATEGIC_HOLD: "#d298ff",
  HOLD_DECISION: "#d298ff",
  NO_DECISION: "#8b96a5",
};

const CONDITION_COLOR: Record<string, string> = {
  DRY: "#22d3a6",
  DAMP: "#f59e0b",
  WET: "#60a5fa",
  DRYING: "#a78bfa",
  WETTING: "#f97316",
  UNKNOWN: "#6b7280",
};

const COMPOUND_LABEL: Record<string, string> = {
  SOFT: "S",
  MEDIUM: "M",
  HARD: "H",
  INTERMEDIATE: "I",
  WET: "W",
};

const COMPOUND_COLOR: Record<string, string> = {
  SOFT: "#ef4444",
  MEDIUM: "#f59e0b",
  HARD: "#94a3b8",
  INTERMEDIATE: "#22c55e",
  WET: "#3b82f6",
};

function pct(v: number) { return `${(v * 100).toFixed(0)}%`; }

// ── Sub-components ─────────────────────────────────────────────────────────────

function Gauge({ label, value, color }: { label: string; value: number; color?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="se-gauge">
      <div className="se-gauge-row">
        <span className="se-gauge-label">{label}</span>
        <b className="se-gauge-val" style={{ color: color ?? "var(--text-primary)" }}>{clamped.toFixed(0)}%</b>
      </div>
      <div className="se-bar">
        <div className="se-bar-fill" style={{ width: `${clamped}%`, background: color ?? "var(--cyan)" }} />
      </div>
    </div>
  );
}

function TyreCompoundBadge({ compound, active }: { compound: string; active?: boolean }) {
  const col = COMPOUND_COLOR[compound] ?? "#6b7280";
  return (
    <span
      className="se-compound-badge"
      style={{
        background: active ? `${col}28` : "transparent",
        border: `1px solid ${active ? col : "var(--border)"}`,
        color: active ? col : "var(--text-dim)",
      }}
    >
      {COMPOUND_LABEL[compound] ?? compound}
    </span>
  );
}

function TyreScoreBar({ compound, score, isCurrent, isRecommended }: {
  compound: string; score: number; isCurrent: boolean; isRecommended: boolean;
}) {
  const col = COMPOUND_COLOR[compound] ?? "#6b7280";
  const clamped = Math.max(0, Math.min(100, score * 100));
  return (
    <div className="se-tyre-score-row">
      <div className="se-tyre-score-label">
        <TyreCompoundBadge compound={compound} active={isCurrent || isRecommended} />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 4 }}>
          {isCurrent && <span style={{ color: "var(--cyan)" }}>ON</span>}
          {isRecommended && !isCurrent && <span style={{ color: col }}>REC</span>}
        </span>
      </div>
      <div className="se-bar" style={{ flex: 1, margin: "0 8px" }}>
        <div
          className="se-bar-fill"
          style={{
            width: `${clamped}%`,
            background: col,
            boxShadow: (isCurrent || isRecommended) ? `0 0 8px ${col}66` : "none",
          }}
        />
      </div>
      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: col, width: 36, textAlign: "right" }}>
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}

function SystemHealthPanel({ system, accepted, visionConf }: {
  system: AnalysisResult["system"] | null;
  accepted: boolean;
  visionConf: number;
}) {
  if (!system) return null;

  const statusColors: Record<string, string> = {
    HEALTHY: "#22d3a6",
    DEGRADED: "#f59e0b",
    STALE: "#f97316",
    LOST: "#ef4444",
  };
  const col = statusColors[system.status] ?? "#6b7280";

  return (
    <div className="se-health-panel">
      <div className="se-section-label">System Health</div>
      <div className="se-health-status" style={{ color: col }}>
        <span className="se-health-dot" style={{ background: col }} />
        {system.status}
      </div>
      <div className="se-mini-grid">
        <div className="se-mini-cell">
          <span className="se-mini-label">Vision Conf.</span>
          <b style={{ color: "var(--text-primary)" }}>{pct(visionConf)}</b>
        </div>
        <div className="se-mini-cell">
          <span className="se-mini-label">Data Conf.</span>
          <b style={{ color: "var(--text-primary)" }}>{pct(system.data_confidence)}</b>
        </div>
        <div className="se-mini-cell">
          <span className="se-mini-label">Sensor Agree.</span>
          <b style={{ color: "var(--text-primary)" }}>{pct(system.sensor_agreement)}</b>
        </div>
        <div className="se-mini-cell">
          <span className="se-mini-label">Frame</span>
          <b style={{ color: accepted ? "#22d3a6" : "#ef4444" }}>{accepted ? "ACCEPTED" : "REJECTED"}</b>
        </div>
        <div className="se-mini-cell">
          <span className="se-mini-label">Frame Age</span>
          <b style={{ color: "var(--text-primary)" }}>{system.frame_age_seconds.toFixed(1)}s</b>
        </div>
      </div>
      {system.warnings?.map((w, i) => (
        <div key={i} className="se-warning">⚠ {w}</div>
      ))}
    </div>
  );
}

// ── Tiny SVG trend chart ──────────────────────────────────────────────────────
function StrategyTrendChart({ data }: { data: AnalysisResult["trend"] }) {
  if (!data || data.length < 2) {
    return (
      <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>No trend data yet — run the rain demo</span>
      </div>
    );
  }

  const W = 700, H = 100, P = 14;
  const pts = data.map((d, i) => {
    const x = P + (i / Math.max(1, data.length - 1)) * (W - 2 * P);
    const y = H - P - (d.wetness ?? 0) * (H - 2 * P);
    return `${x},${y}`;
  }).join(" ");

  const conditionColor = data.length ? CONDITION_COLOR[data[data.length - 1]?.condition ?? "UNKNOWN"] : "#6b7280";

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
      {[0.25, 0.5, 0.75].map(v => (
        <line
          key={v}
          x1={P} x2={W - P}
          y1={H - P - v * (H - 2 * P)}
          y2={H - P - v * (H - 2 * P)}
          stroke="rgba(255,255,255,0.06)" strokeWidth={1}
        />
      ))}
      <polyline
        points={pts}
        fill="none"
        stroke={conditionColor}
        strokeWidth={2.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function StrategyEngine({ sessionId }: { sessionId: string | null }) {
  const SESSION = sessionId ?? "strategy-demo";

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [tyre, setTyre] = useState<TyreState>({
    compound: "MEDIUM",
    health: 0.88,
    age_laps: 12,
    changes_remaining: 1,
    pit_loss_seconds: 21,
  });

  const runDemoStep = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = buildDemoPayload(SESSION, demoStep, tyre, null);
      const res = await ingestObservation(payload);
      setResult(res);
      setDemoStep(s => s + 1);
    } catch (e) { console.error(e); }
    finally { setBusy(false); }
  }, [busy, demoStep, tyre, SESSION]);

  const handleReset = useCallback(async () => {
    await resetStrategy(SESSION);
    setResult(null);
    setDemoStep(0);
  }, [SESSION]);

  const updateTyre = (k: keyof TyreState, v: TyreState[keyof TyreState]) =>
    setTyre(prev => ({ ...prev, [k]: v }));

  const strategy = result?.strategy ?? null;
  const actionColor = strategy ? (ACTION_COLOR[strategy.action] ?? "#8b96a5") : "var(--text-dim)";
  const condColor = result ? (CONDITION_COLOR[result.condition] ?? "#6b7280") : "var(--text-dim)";

  return (
    <div className="se-root">
      {/* ── Header ── */}
      <div className="se-header">
        <div className="se-header-left">
          <span className="se-badge" style={{ background: condColor + "22", color: condColor, borderColor: condColor + "66" }}>
            {result?.condition ?? "NO DATA"}
          </span>
          {result?.whiplash && (
            <span className="se-whiplash-badge">
              ⚠ WHIPLASH — {result.whiplash_message}
            </span>
          )}
          {result && !result.accepted_frame && (
            <span className="se-rejected-badge">
              FRAME REJECTED — {result.rejection_reasons?.join(", ")}
            </span>
          )}
        </div>
        <div className="se-header-actions">
          <button
            className="se-btn"
            onClick={runDemoStep}
            disabled={busy}
            title="Step through a simulated rain sequence to demonstrate strategy changes"
          >
            {busy ? "…" : "▶ Rain Step"}
          </button>
          <button className="se-btn se-btn-ghost" onClick={handleReset}>↺ Reset</button>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="se-grid">

        {/* ── Column 1: Track condition + gauges ── */}
        <div className="se-panel">
          <div className="se-section-label">Track Condition</div>
          <div className="se-condition" style={{ color: condColor }}>
            {result?.condition ?? "UNKNOWN"}
          </div>
          <Gauge label="Filtered Wetness" value={(result?.filtered_wetness ?? 0) * 100} color={condColor} />
          <div className="se-rate-row">
            <span className="se-mini-label">Change Rate</span>
            <b style={{ color: (result?.wetness_rate_per_min ?? 0) > 0 ? "#f97316" : "#22d3a6" }}>
              {result
                ? `${result.wetness_rate_per_min >= 0 ? "+" : ""}${(result.wetness_rate_per_min * 100).toFixed(1)}% / min`
                : "—"}
            </b>
          </div>
          {result?.racing_line_wetness != null && (
            <Gauge label="Racing Line" value={result.racing_line_wetness * 100} color="#22d3ee" />
          )}
          {result?.offline_wetness != null && (
            <Gauge label="Off-Line" value={result.offline_wetness * 100} color="#a78bfa" />
          )}

          {/* Trend chart */}
          <div style={{ marginTop: 14 }}>
            <div className="se-section-label">Wetness Trend</div>
            <StrategyTrendChart data={result?.trend ?? []} />
          </div>
        </div>

        {/* ── Column 2: Tyre strategy ── */}
        <div className="se-panel">
          <div className="se-section-label">Tyre Strategy</div>
          {strategy ? (
            <>
              <div className="se-action" style={{ color: actionColor }}>
                {strategy.action.replace(/_/g, " ")}
              </div>
              <div className="se-strategy-grid">
                <div className="se-strategy-cell">
                  <span className="se-mini-label">Current</span>
                  <TyreCompoundBadge compound={strategy.current_tyre} active />
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>
                    {pct(strategy.current_compatibility)} compat
                  </span>
                </div>
                <div className="se-strategy-cell">
                  <span className="se-mini-label">Recommended</span>
                  <TyreCompoundBadge compound={strategy.recommended_tyre} active />
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>
                    {pct(strategy.recommended_compatibility)} compat
                  </span>
                </div>
                <div className="se-strategy-cell">
                  <span className="se-mini-label">Crossover Window</span>
                  <b style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 15, color: strategy.crossover_laps ? "var(--cyan)" : "var(--text-dim)" }}>
                    {strategy.crossover_laps
                      ? `${strategy.crossover_laps[0]}–${strategy.crossover_laps[1]} laps`
                      : "—"}
                  </b>
                </div>
                <div className="se-strategy-cell">
                  <span className="se-mini-label">Risk Score</span>
                  <b style={{
                    fontFamily: "Space Grotesk, sans-serif", fontSize: 15,
                    color: strategy.risk_score >= 76 ? "#ef4444" : strategy.risk_score >= 50 ? "#f59e0b" : "#22d3a6",
                  }}>
                    {strategy.risk_score}<span style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 400 }}>/100</span>
                  </b>
                </div>
              </div>

              {/* Confidence bar */}
              <div style={{ marginTop: 14 }}>
                <Gauge
                  label={`Strategy Confidence`}
                  value={strategy.strategy_confidence * 100}
                  color={strategy.strategy_confidence >= 0.65 ? "#22d3a6" : strategy.strategy_confidence >= 0.42 ? "#f59e0b" : "#ef4444"}
                />
              </div>

              {/* Reasons */}
              {strategy.reasons.length > 0 && (
                <div className="se-reasons">
                  {strategy.reasons.map((r, i) => (
                    <div key={i} className="se-reason-item">• {r}</div>
                  ))}
                </div>
              )}

              {/* Tyre scores breakdown */}
              <div style={{ marginTop: 16 }}>
                <div className="se-section-label">Compound Scores (strategic)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  {strategy.scores.map(s => (
                    <TyreScoreBar
                      key={s.compound}
                      compound={s.compound}
                      score={Math.max(0, s.strategic_score)}
                      isCurrent={s.compound === strategy.current_tyre}
                      isRecommended={s.compound === strategy.recommended_tyre && s.compound !== strategy.current_tyre}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="se-empty">
              Use <strong>▶ Rain Step</strong> to simulate a wetting track and see strategy decisions
            </div>
          )}
        </div>

        {/* ── Column 3: Tyre controls + system health ── */}
        <div className="se-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Tyre controls */}
          <div>
            <div className="se-section-label">Current Tyre State</div>

            <div className="se-controls">
              <label className="se-control-label">
                Compound
                <select
                  className="se-select"
                  value={tyre.compound}
                  onChange={e => updateTyre("compound", e.target.value as TyreState["compound"])}
                >
                  {["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label className="se-control-label">
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Health</span>
                  <span style={{ color: "var(--cyan)", fontFamily: "JetBrains Mono, monospace" }}>
                    {Math.round(tyre.health * 100)}%
                  </span>
                </div>
                <input
                  type="range" min={10} max={100} step={1}
                  value={Math.round(tyre.health * 100)}
                  onChange={e => updateTyre("health", Number(e.target.value) / 100)}
                  className="se-range"
                />
                <div className="se-bar" style={{ marginTop: 4 }}>
                  <div className="se-bar-fill" style={{
                    width: `${tyre.health * 100}%`,
                    background: tyre.health >= 0.7 ? "#22d3a6" : tyre.health >= 0.45 ? "#f59e0b" : "#ef4444",
                  }} />
                </div>
              </label>

              <div className="se-two-col">
                <label className="se-control-label">
                  Age (laps)
                  <input
                    type="number" min={0} max={80}
                    className="se-number"
                    value={tyre.age_laps}
                    onChange={e => updateTyre("age_laps", Number(e.target.value))}
                  />
                </label>
                <label className="se-control-label">
                  Changes Left
                  <input
                    type="number" min={0} max={10}
                    className="se-number"
                    value={tyre.changes_remaining}
                    onChange={e => updateTyre("changes_remaining", Number(e.target.value))}
                  />
                </label>
              </div>

              <div className="se-two-col">
                <label className="se-control-label">
                  Pit Loss (s)
                  <input
                    type="number" min={10} max={60}
                    className="se-number"
                    value={tyre.pit_loss_seconds}
                    onChange={e => updateTyre("pit_loss_seconds", Number(e.target.value))}
                  />
                </label>
                <label className="se-control-label">
                  Temp (°C)
                  <input
                    type="number" min={30} max={150}
                    className="se-number"
                    value={tyre.temperature_c ?? ""}
                    placeholder="auto"
                    onChange={e => updateTyre("temperature_c", e.target.value ? Number(e.target.value) : null)}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* System health */}
          <SystemHealthPanel
            system={result?.system ?? null}
            accepted={result?.accepted_frame ?? true}
            visionConf={result?.vision_confidence ?? 0}
          />
        </div>
      </div>
    </div>
  );
}
