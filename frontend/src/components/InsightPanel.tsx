import type { DecisionFrame } from "../types";
import { chipColor } from "../theme";

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="glass-panel flex flex-col gap-1 p-3 min-w-0">
      <span className="font-display text-[10px] uppercase tracking-[0.15em] text-neutral-400 truncate" title={label}>{label}</span>
      <span className="font-mono text-xl font-bold tracking-tight truncate shadow-[0_0_8px_currentColor]" title={value} style={{ color: color ?? "#e5e5e5" }}>
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
    <div className="flex flex-col gap-2 shrink-0">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Rate (line)" value={`${frame.rate_line_per_min >= 0 ? "+" : ""}${frame.rate_line_per_min.toFixed(3)} W/min`} color={color} />
        <Stat label="Line ↔ off-line divergence" value={frame.divergence.toFixed(3)} />
        <Stat label="Tire-change window" value={crossoverText} color={color} />
      </div>
      <div className="flex gap-2">
        <div
          className="flex-1 min-w-0 rounded border px-4 py-2.5 text-sm font-medium"
          style={{ borderColor: `${color}55`, backgroundColor: `${color}12`, color: "#f4f4f5" }}
        >
          <span className="opacity-60 uppercase text-[10px] tracking-wider block mb-1">Strategic Suggestion</span>
          <div className="break-words line-clamp-2" title={frame.suggestion}>{frame.suggestion}</div>
        </div>
        {frame.evidence?.line?.note && (
          <div
            className="flex-1 min-w-0 rounded border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "#00F0FF55", backgroundColor: "#00F0FF12", color: "#f4f4f5" }}
          >
            <span className="opacity-60 uppercase text-[10px] tracking-wider block mb-1 text-neon-cyan">AI Visual Reasoning</span>
            <div className="break-words line-clamp-2" title={frame.evidence.line.note}>{frame.evidence.line.note}</div>
          </div>
        )}
      </div>
    </div>
  );
}
