import { useEffect, useState } from "react";
import type { DecisionFrame, Provider, ProviderStatus, WeatherResponse } from "../types";
import { exportCsvUrl, getProviders, getWeather, selectProvider } from "../api";

const WEATHER_POLL_MS = 15_000;

function WeatherBadge({ sessionId }: { sessionId: string | null }) {
  const [data, setData] = useState<WeatherResponse | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const tick = () => getWeather(sessionId).then((r) => !cancelled && setData(r)).catch(() => {});
    tick();
    const interval = setInterval(tick, WEATHER_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sessionId]);

  if (!data || !data.available) return null;

  const { conditions, agreement } = data;
  const color = agreement === "agree" ? "#22d3ee" : agreement === "disagree" ? "#ef4444" : "#6b7280";
  const rainText = conditions.is_raining
    ? "raining"
    : conditions.minutes_since_rain != null
      ? `rain ${conditions.minutes_since_rain < 1 ? "<1" : Math.round(conditions.minutes_since_rain)}m ago`
      : "no rain";

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6 }}
      title={`Open-Meteo (${conditions.source}) — cross-check, not a correction`}
    >
      <span style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--text-dim)", textTransform: "uppercase" }}>weather</span>
      <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{rainText}</span>
      <span style={{
        borderRadius: 2, padding: "1px 6px", fontSize: 9, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.06em",
        color, backgroundColor: `${color}22`,
      }}>
        {agreement}
      </span>
    </div>
  );
}

const PROVIDER_COLOR: Record<Provider, string> = {
  stub: "#6b7280", cache: "#6b7280",
  gemini: "#22d3ee", groq: "#22d3ee", openrouter: "#22d3ee",
  none: "#ef4444",
};

function ProviderIndicator({ frame }: { frame: DecisionFrame | null }) {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [forced, setForced] = useState("auto");

  useEffect(() => {
    getProviders().then((r) => setStatuses(r.providers)).catch(() => {});
  }, [frame?.provider]);

  const provider = frame?.provider ?? "stub";
  const color = PROVIDER_COLOR[provider] ?? "#6b7280";

  async function onChange(value: string) {
    setForced(value);
    try {
      const r = await selectProvider(value === "auto" ? null : value);
      setStatuses(r.providers);
    } catch { /* ignore */ }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--text-dim)", textTransform: "uppercase" }}>provider</span>
      <span style={{
        borderRadius: 2, padding: "1px 6px", fontSize: 9, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.06em",
        color, backgroundColor: `${color}22`,
      }}>
        {provider}
      </span>
      {statuses.length > 0 && (
        <select
          value={forced}
          onChange={(e) => onChange(e.target.value)}
          style={{
            background: "var(--bg-surface)", border: "1px solid var(--border)",
            borderRadius: 3, padding: "2px 6px", fontSize: 10,
            color: "var(--text-secondary)", outline: "none",
          }}
          title="Force a specific provider"
        >
          <option value="auto">auto</option>
          {statuses.map((s) => (
            <option key={s.name} value={s.name} disabled={!s.configured}>
              {s.name}{!s.configured ? " (no key)" : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function Footer({
  frame,
  sessionId,
  naiveMode,
  onToggleNaive,
  compact = false,
}: {
  frame: DecisionFrame | null;
  sessionId: string | null;
  naiveMode: boolean;
  onToggleNaive: () => void;
  compact?: boolean;
}) {
  const pct = frame ? Math.round(frame.model_confidence * 100) : 0;
  const ok = frame?.confidence_ok ?? true;
  const barColor = ok ? "#00e5ff" : "#ef4444";

  if (compact) {
    // Compact inline mode for chart header
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {/* Confidence mini */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--text-dim)", textTransform: "uppercase" }}>conf</span>
          <div style={{ width: 60, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 2, boxShadow: `0 0 6px ${barColor}` }} />
          </div>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--text-secondary)" }}>{frame ? `${pct}%` : "—"}</span>
        </div>
        <ProviderIndicator frame={frame} />
        <WeatherBadge sessionId={sessionId} />
        {sessionId && (
          <a
            href={exportCsvUrl(sessionId)}
            download={`${sessionId}.csv`}
            style={{
              fontSize: 9, fontWeight: 600, letterSpacing: "0.06em",
              color: "var(--text-dim)", textDecoration: "none",
              border: "1px solid var(--border)", borderRadius: 3,
              padding: "2px 8px", textTransform: "uppercase", transition: "all 0.15s",
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = "var(--cyan)"; (e.target as HTMLElement).style.color = "var(--cyan)"; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = "var(--border)"; (e.target as HTMLElement).style.color = "var(--text-dim)"; }}
          >
            CSV
          </a>
        )}
        <button
          onClick={onToggleNaive}
          style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "3px 8px", borderRadius: 3, border: "1px solid",
            cursor: "pointer", transition: "all 0.15s",
            borderColor: naiveMode ? "rgba(245,166,35,0.6)" : "var(--border)",
            background: naiveMode ? "rgba(245,166,35,0.1)" : "transparent",
            color: naiveMode ? "#f5a623" : "var(--text-dim)",
          }}
        >
          Naive A/B: {naiveMode ? "ON" : "OFF"}
        </button>
      </div>
    );
  }

  // Full footer (used in logs/history views)
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16,
      borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.3)",
      backdropFilter: "blur(8px)", padding: "10px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 9, letterSpacing: "0.12em", color: "var(--text-dim)", textTransform: "uppercase" }}>Confidence</span>
        <div style={{ width: 120, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--border)" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 3, boxShadow: `0 0 8px ${barColor}` }} />
        </div>
        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--text-secondary)", minWidth: 36 }}>
          {frame ? `${pct}%` : "—"}
        </span>
      </div>
      <ProviderIndicator frame={frame} />
      <WeatherBadge sessionId={sessionId} />
      <div style={{ flex: 1 }} />
      {sessionId && (
        <a
          href={exportCsvUrl(sessionId)}
          download={`${sessionId}.csv`}
          style={{
            fontSize: 11, fontWeight: 500, color: "var(--text-secondary)",
            textDecoration: "none", border: "1px solid var(--border)",
            borderRadius: 4, padding: "4px 12px", transition: "all 0.15s",
          }}
        >
          Export CSV
        </a>
      )}
      <button
        onClick={onToggleNaive}
        style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "4px 14px", borderRadius: 4, border: "1px solid",
          cursor: "pointer", transition: "all 0.15s",
          borderColor: naiveMode ? "rgba(245,166,35,0.6)" : "var(--border)",
          background: naiveMode ? "rgba(245,166,35,0.08)" : "transparent",
          color: naiveMode ? "#f5a623" : "var(--text-dim)",
        }}
      >
        Naive classifier A/B: {naiveMode ? "ON" : "OFF"}
      </button>
    </div>
  );
}
