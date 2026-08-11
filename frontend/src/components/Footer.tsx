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
          title="force a specific provider (runtime-switchable, see CLAUDE.md section 3)"
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
    <div className="flex items-center gap-4 border-t border-neutral-800 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">confidence</span>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        </div>
        <span className="text-xs tabular-nums text-neutral-400">{frame ? `${pct}%` : "—"}</span>
      </div>

      <ProviderIndicator frame={frame} />
      <WeatherBadge sessionId={sessionId} />

      <div className="flex-1" />

      <a
        href={sessionId ? exportCsvUrl(sessionId) : undefined}
        download={sessionId ? `${sessionId}.csv` : undefined}
        aria-disabled={!sessionId}
        className={`rounded border px-3 py-1.5 text-xs font-medium ${
          sessionId
            ? "border-neutral-700 text-neutral-300 hover:border-cyan-400 hover:text-cyan-300"
            : "cursor-not-allowed border-neutral-800 text-neutral-600"
        }`}
      >
        Export CSV
      </a>

      <button
        onClick={onToggleNaive}
        className={`rounded border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
          naiveMode
            ? "border-amber-500 bg-amber-500/10 text-amber-300"
            : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
        }`}
      >
        Naive classifier A/B: {naiveMode ? "ON" : "OFF"}
      </button>
    </div>
  );
}
