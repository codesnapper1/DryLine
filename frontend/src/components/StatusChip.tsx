import type { DecisionFrame } from "../types";
import { chipColor, naiveLabel, COLOR_STABLE } from "../theme";

const TREND_ARROW: Record<string, string> = { drying: "↓", wetting: "↑", stable: "→" };

export default function StatusChip({ frame, naiveMode, baselineLabel, isProcessing = false }: { frame: DecisionFrame | null; naiveMode: boolean; baselineLabel?: string | null; isProcessing?: boolean }) {
  if (isProcessing) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
        <span className="text-xl font-bold uppercase tracking-widest text-neon-cyan animate-pulse">Running VLM Inference...</span>
      </div>
    );
  }

  if (!frame && !baselineLabel) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60">
        <span className="text-sm text-neutral-500">waiting for first frame…</span>
      </div>
    );
  }

  if (naiveMode || baselineLabel) {
    const label = baselineLabel || (frame ? naiveLabel(frame.raw_w_line) : "UNKNOWN");
    return (
      <div className="glass-panel flex h-full flex-col justify-center gap-2 px-8 py-4 border-l-4 border-l-neutral-600">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-500">naive classifier</span>
        <span className="font-display text-7xl font-black leading-none tracking-tighter text-neutral-200 drop-shadow-md">{label}</span>
        <span className="text-xs text-neutral-500 font-mono opacity-80 mt-1">per-frame appearance only — no rate, no drying</span>
      </div>
    );
  }


  const isLowConf = frame.displayed_label === "LOW_CONFIDENCE";
  const color = isLowConf ? COLOR_STABLE : chipColor(frame);

  return (
    <div
      className="glass-panel flex h-full flex-col justify-center gap-1 px-8 py-4 transition-all duration-300"
      style={{ 
        borderLeft: `4px solid ${color}`, 
        boxShadow: `0 0 40px ${color}15, inset 0 0 20px ${color}10`,
      }}
    >
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color }}>
        {isLowConf ? "gate rejected" : frame.trend}
      </span>
      <span className="font-display text-7xl font-black leading-none tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]">
        {isLowConf ? (
          <span className="bg-racing-red/20 text-racing-red px-4 rounded-xl">LOW CONF.</span>
        ) : frame.displayed_label}
      </span>
      {isLowConf ? (
        <span className="font-mono text-xs text-racing-red opacity-80 mt-2">{frame.confidence_reasons.join(", ")}</span>
      ) : (
        <span className="font-mono mt-2 flex items-center gap-2 text-sm font-medium" style={{ color }}>
          <span className="text-lg">{TREND_ARROW[frame.trend]}</span>
          {frame.rate_line_per_min.toFixed(3)} W/min
        </span>
      )}
    </div>
  );
}
