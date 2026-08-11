import type { DecisionFrame } from "../types";
import { chipColor, naiveLabel, COLOR_STABLE } from "../theme";

const TREND_ARROW: Record<string, string> = { drying: "↓", wetting: "↑", stable: "→" };

export default function StatusChip({ frame, naiveMode }: { frame: DecisionFrame | null; naiveMode: boolean }) {
  if (!frame) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60">
        <span className="text-sm text-neutral-500">waiting for first frame…</span>
      </div>
    );
  }

  if (naiveMode) {
    const label = naiveLabel(frame.raw_w_line);
    return (
      <div className="flex h-full flex-col justify-center gap-1 rounded-lg border-2 border-neutral-700 bg-neutral-900 px-6 py-4">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-500">naive classifier</span>
        <span className="text-6xl font-black leading-none tracking-tight text-neutral-200">{label}</span>
        <span className="text-xs text-neutral-500">per-frame appearance only — no rate, no drying</span>
      </div>
    );
  }

  const isLowConf = frame.displayed_label === "LOW_CONFIDENCE";
  const color = isLowConf ? COLOR_STABLE : chipColor(frame);

  return (
    <div
      className="flex h-full flex-col justify-center gap-1 rounded-lg border-2 px-6 py-4 transition-colors"
      style={{ borderColor: color, backgroundColor: `${color}14` }}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color }}>
        {isLowConf ? "gate rejected" : frame.trend}
      </span>
      <span className="text-6xl font-black leading-none tracking-tight text-neutral-50">
        {isLowConf ? "LOW CONF." : frame.displayed_label}
      </span>
      {isLowConf ? (
        <span className="text-xs text-neutral-400">{frame.confidence_reasons.join(", ")}</span>
      ) : (
        <span className="flex items-center gap-1 text-sm font-medium" style={{ color }}>
          <span className="text-lg">{TREND_ARROW[frame.trend]}</span>
          {frame.rate_line_per_min.toFixed(3)} W/min
        </span>
      )}
    </div>
  );
}
