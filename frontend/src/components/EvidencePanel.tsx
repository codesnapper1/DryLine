import type { DecisionFrame, EvidenceRegion } from "../types";
import { COLOR_LINE, COLOR_OFF_LINE } from "../theme";

const FIELD_LABELS: [keyof EvidenceRegion, string][] = [
  ["surface_gloss", "gloss"],
  ["standing_water", "standing water"],
  ["reflections_visible", "reflections"],
  ["spray_from_cars", "spray"],
  ["dry_patches_forming", "dry patches"],
];

function fieldValue(region: EvidenceRegion, key: keyof EvidenceRegion): string {
  const v = region[key];
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v).replace(/_/g, " ");
}

function RegionColumn({ label, color, region }: { label: string; color: string; region: EvidenceRegion }) {
  return (
    <div className="flex-1 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color }}>
          {label}
        </span>
        {region.occluded_or_unclear && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300">
            occluded
          </span>
        )}
      </div>
      <dl className="space-y-0.5 text-xs">
        {FIELD_LABELS.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-2">
            <dt className="text-neutral-500">{label}</dt>
            <dd className="text-neutral-200">{fieldValue(region, key)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-2 pt-0.5">
          <dt className="text-neutral-500">wetness / conf.</dt>
          <dd className="tabular-nums text-neutral-200">
            {region.wetness_0_100}% / {region.confidence_0_100}%
          </dd>
        </div>
      </dl>
      {region.note && <p className="truncate text-[11px] italic text-neutral-500" title={region.note}>{region.note}</p>}
    </div>
  );
}

export default function EvidencePanel({ frame }: { frame: DecisionFrame | null }) {
  const lineEv = frame?.evidence?.line ?? null;
  const offLineEv = frame?.evidence?.off_line ?? null;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">VLM Evidence</h2>
      {lineEv && offLineEv ? (
        <div className="flex gap-4">
          <RegionColumn label="A · on-line" color={COLOR_LINE} region={lineEv} />
          <div className="w-px bg-neutral-800" />
          <RegionColumn label="B · off-line" color={COLOR_OFF_LINE} region={offLineEv} />
        </div>
      ) : (
        <p className="text-xs text-neutral-500">
          {frame ? "No VLM evidence for this frame — simulated decider (stub mode) or provider outage." : "waiting for first frame…"}
        </p>
      )}
    </div>
  );
}
