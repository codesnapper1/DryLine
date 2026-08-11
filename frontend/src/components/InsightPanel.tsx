import type { DecisionFrame } from "../types";
import { chipColor } from "../theme";

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-neutral-800 bg-neutral-900/60 px-3 py-2">
      <span className="text-[10px] uppercase tracking-widest text-neutral-500">{label}</span>
      <span className="text-lg font-bold tabular-nums" style={{ color: color ?? "#e5e5e5" }}>
        {value}
      </span>
    </div>
  );
}

export default function InsightPanel({ frame, naiveMode }: { frame: DecisionFrame | null; naiveMode: boolean }) {
  if (!frame) return <div className="h-24 rounded border border-neutral-800 bg-neutral-900/40" />;

  if (naiveMode) {
    return (
      <div className="flex items-center gap-3 rounded border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
        <span className="text-lg">⚠</span>
        A per-frame classifier has no history to compute a rate, a crossover ETA, or a "Drying"
        state from — that's the whole reason this exists as a temporal-filter problem, not a
        4-way softmax. Toggle naive mode off to see the real pipeline.
      </div>
    );
  }

  const color = chipColor(frame);
  const crossoverText = frame.crossover
    ? `${frame.crossover.eta_laps.toFixed(1)} laps → ${frame.crossover.target_compound}`
    : "—";

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Rate (line)" value={`${frame.rate_line_per_min >= 0 ? "+" : ""}${frame.rate_line_per_min.toFixed(3)} W/min`} color={color} />
        <Stat label="Line ↔ off-line divergence" value={frame.divergence.toFixed(3)} />
        <Stat label="Tire-change window" value={crossoverText} color={color} />
      </div>
      <div
        className="rounded border px-4 py-2.5 text-sm font-medium"
        style={{ borderColor: `${color}55`, backgroundColor: `${color}12`, color: "#f4f4f5" }}
      >
        {frame.suggestion}
      </div>
    </div>
  );
}
