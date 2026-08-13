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
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId]);

  if (!data || !data.available) return null; // no lat/lon configured for this session — nothing to show

  const { conditions, agreement } = data;
  const color = agreement === "agree" ? "#22d3ee" : agreement === "disagree" ? "#ef4444" : "#6b7280";
  const rainText = conditions.is_raining
    ? "raining now"
    : conditions.minutes_since_rain != null
      ? `rain stopped ${conditions.minutes_since_rain < 1 ? "<1" : Math.round(conditions.minutes_since_rain)}min ago`
      : "no recent rain";

  return (
    <div
      className="flex items-center gap-1.5"
      title={`Open-Meteo (${conditions.source}) cross-check against the observed trend — an independent signal, not a correction`}
    >
      <span className="text-[10px] uppercase tracking-widest text-neutral-500">weather</span>
      <span className="text-xs text-neutral-300">{rainText}</span>
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
        style={{ color, backgroundColor: `${color}22` }}
      >
        {agreement}
      </span>
    </div>
  );
}

const PROVIDER_COLOR: Record<Provider, string> = {
  stub: "#6b7280",
  cache: "#6b7280",
  gemini: "#22d3ee",
  groq: "#22d3ee",
  openrouter: "#22d3ee",
  none: "#ef4444",
};

function ProviderIndicator({ frame }: { frame: DecisionFrame | null }) {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [forced, setForced] = useState("auto");

  useEffect(() => {
    getProviders()
      .then((r) => setStatuses(r.providers))
      .catch(() => {});
  }, [frame?.provider]);

  const provider = frame?.provider ?? "stub";
  const color = PROVIDER_COLOR[provider] ?? "#6b7280";

  async function onChange(value: string) {
    setForced(value);
    try {
      const r = await selectProvider(value === "auto" ? null : value);
      setStatuses(r.providers);
    } catch {
      /* selection failures surface via the next frame's provider field */
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest text-neutral-500">provider</span>
      <span
        className="rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide"
        style={{ color, backgroundColor: `${color}22` }}
        title={provider === "none" ? "every configured provider failed on the last frame" : undefined}
      >
        {provider}
      </span>
      {statuses.length > 0 && (
        <select
          value={forced}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[11px] text-neutral-400"
          title="force a specific provider — the chain is runtime-switchable"
        >
          <option value="auto">auto</option>
          {statuses.map((s) => (
            <option key={s.name} value={s.name} disabled={!s.configured}>
              {s.name}
              {!s.configured ? " (no key)" : ""}
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
}: {
  frame: DecisionFrame | null;
  sessionId: string | null;
  naiveMode: boolean;
  onToggleNaive: () => void;
}) {
  const pct = frame ? Math.round(frame.model_confidence * 100) : 0;
  const ok = frame?.confidence_ok ?? true;
  const barColor = ok ? "#22d3ee" : "#ef4444";

  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-white/5 bg-black/40 backdrop-blur-md px-6 py-3 relative z-10">
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-display text-[10px] uppercase tracking-[0.2em] text-neutral-500">confidence</span>
        <div className="h-2.5 w-24 sm:w-40 overflow-hidden rounded-full bg-neutral-900 border border-white/5 shadow-inner">
          <div
            className="h-full rounded-full transition-all duration-300 shadow-[0_0_10px_currentColor]"
            style={{ width: `${pct}%`, backgroundColor: barColor, color: barColor }}
          />
        </div>
        <span className="font-mono text-xs tabular-nums text-neutral-300 w-10">{frame ? `${pct}%` : "—"}</span>
      </div>

      <div className="shrink-0">
        <ProviderIndicator frame={frame} />
      </div>
      
      <div className="shrink-0">
        <WeatherBadge sessionId={sessionId} />
      </div>

      <div className="flex-1 min-w-[20px]" />

      <a
        href={sessionId ? exportCsvUrl(sessionId) : undefined}
        download={sessionId ? `${sessionId}.csv` : undefined}
        aria-disabled={!sessionId}
        className={`shrink-0 rounded-lg border px-4 py-1.5 text-xs font-medium transition-all duration-300 ${
          sessionId
            ? "border-white/10 text-neutral-300 hover:border-neon-cyan hover:bg-neon-cyan-muted hover:shadow-neon-cyan"
            : "cursor-not-allowed border-neutral-800/50 text-neutral-600 bg-neutral-900/20"
        }`}
      >
        Export CSV
      </a>

      <button
        onClick={onToggleNaive}
        className={`shrink-0 whitespace-nowrap rounded-lg border px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
          naiveMode
            ? "border-status-damp bg-status-damp/10 text-status-damp shadow-[0_0_15px_rgba(245,166,35,0.2)]"
            : "border-white/10 text-neutral-400 hover:border-neutral-500 hover:bg-white/5"
        }`}
      >
        Naive classifier A/B: {naiveMode ? "ON" : "OFF"}
      </button>
    </div>
  );
}
