// Shared colour identities. ON-LINE and OFF-LINE keep the same colour
// everywhere they appear (ROI box, trend line, legend) so the dual-ROI story
// reads as one visual thread. Cyan/amber/red double as the signed trend axis.
export const COLOR_LINE = "#22d3ee"; // cyan-400 — on the racing line
export const COLOR_OFF_LINE = "#a78bfa"; // violet-400 — off the racing line

export const COLOR_DRYING = "#22d3ee"; // cyan — improving
export const COLOR_STABLE = "#6b7280"; // grey — stable
export const COLOR_WETTING_MILD = "#f59e0b"; // amber — damp trending wetter
export const COLOR_WETTING_SEVERE = "#ef4444"; // red — wet/standing trending wetter

import type { DecisionFrame } from "./types";

export function chipColor(f: Pick<DecisionFrame, "trend" | "level">): string {
  if (f.trend === "drying") return COLOR_DRYING;
  if (f.trend === "wetting") {
    return f.level === "wet" || f.level === "standing" ? COLOR_WETTING_SEVERE : COLOR_WETTING_MILD;
  }
  return COLOR_STABLE;
}

export function naiveLevel(rawW: number): "dry" | "damp" | "wet" | "standing" {
  if (rawW < 0.15) return "dry";
  if (rawW < 0.4) return "damp";
  if (rawW < 0.7) return "wet";
  return "standing";
}

export function naiveLabel(rawW: number): "DRY" | "DAMP" | "WET" {
  const level = naiveLevel(rawW);
  return (level === "standing" ? "wet" : level).toUpperCase() as "DRY" | "DAMP" | "WET";
}
