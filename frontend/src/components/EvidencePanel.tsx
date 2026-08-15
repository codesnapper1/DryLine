import type { DecisionFrame, EvidenceRegion } from "../types";
import { COLOR_LINE, COLOR_OFF_LINE } from "../theme";

function GlossBar({ value, label }: { value: string; label: string }) {
  const pct = value === "mirror_like" ? 100 : value === "moderate" ? 65 : value === "slight" ? 35 : 5;
  const color =
    value === "mirror_like" ? "#60a5fa"
    : value === "moderate" ? "#818cf8"
    : value === "slight" ? "#a78bfa"
    : "#4b5563";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-neutral-500 w-16 shrink-0">{label}</span>
      <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.5s ease-out", boxShadow: pct > 30 ? `0 0 6px ${color}88` : "none" }} />
      </div>
      <span className="text-[10px] text-neutral-300 w-16 text-right shrink-0">{value.replace(/_/g, " ")}</span>
    </div>
  );
}

function WetnessGauge({ value, color }: { value: number; color: string }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - value / 100);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
        <circle
          cx="28" cy="28" r={r} fill="none"
          stroke={color} strokeWidth="4"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 28 28)"
          style={{ transition: "stroke-dashoffset 0.6s ease-out", filter: `drop-shadow(0 0 4px ${color}88)` }}
        />
        <text x="28" y="32" textAnchor="middle" fontSize="11" fontWeight="700" fill="white" fontFamily="'JetBrains Mono', monospace">
          {value}%
        </text>
      </svg>
      <span style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>wetness</span>
    </div>
  );
}

function CvMetricRow({ label, value, unit = "", highlight = false }: { label: string; value: number | undefined; unit?: string; highlight?: boolean }) {
  if (value === undefined) return null;
  const display = typeof value === "number" ? (value < 0.01 ? value.toFixed(4) : value.toFixed(3)) : String(value);
  return (
    <div className="flex justify-between items-center gap-2" style={{ fontSize: 10 }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: highlight ? "#f59e0b" : "var(--text-secondary)", fontWeight: 600 }}>
        {display}{unit}
      </span>
    </div>
  );
}

function Badge({ label, active, color }: { label: string; active: boolean; color: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
      padding: "2px 6px", borderRadius: 3,
      background: active ? `${color}22` : "rgba(255,255,255,0.03)",
      border: `1px solid ${active ? color + "66" : "rgba(255,255,255,0.06)"}`,
      color: active ? color : "var(--text-dim)",
    }}>
      {label}
    </span>
  );
}

function RegionPanel({ label, color, region }: { label: string; color: string; region: EvidenceRegion }) {
  const isCv = region.cv_method === "opencv_cv";
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 6px ${color}` }} />
        <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color }}>
          {label}
        </span>
        {region.occluded_or_unclear && (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "1px 5px", borderRadius: 3, background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>
            OCCLUDED
          </span>
        )}
        {isCv && (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "1px 5px", borderRadius: 3, background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)", marginLeft: "auto" }}>
            CV
          </span>
        )}
      </div>

      {/* Wetness + Confidence gauge */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <WetnessGauge value={region.wetness_0_100} color={color} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
            <span style={{ color: "var(--text-dim)" }}>confidence</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-primary)", fontWeight: 600 }}>{region.confidence_0_100}%</span>
          </div>
          <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2 }}>
            <div style={{ height: "100%", width: `${region.confidence_0_100}%`, background: color, borderRadius: 2, opacity: 0.7, transition: "width 0.5s" }} />
          </div>
          {/* Quick badges */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
            <Badge label="reflections" active={region.reflections_visible} color="#60a5fa" />
            <Badge label="water" active={region.standing_water !== "none"} color="#3b82f6" />
            <Badge label="spray" active={region.spray_from_cars !== "none" && region.spray_from_cars !== "not_visible"} color="#818cf8" />
          </div>
        </div>
      </div>

      {/* Gloss bar */}
      <GlossBar value={region.surface_gloss} label="surface gloss" />

      {/* Detail rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
          <span style={{ color: "var(--text-dim)" }}>standing water</span>
          <span style={{ color: region.standing_water !== "none" ? "#60a5fa" : "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.06em" }}>{region.standing_water.replace(/_/g, " ")}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
          <span style={{ color: "var(--text-dim)" }}>dry patches</span>
          <span style={{ color: region.dry_patches_forming !== "none" ? "#22c55e" : "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.06em" }}>{region.dry_patches_forming.replace(/_/g, " ")}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
          <span style={{ color: "var(--text-dim)" }}>spray</span>
          <span style={{ color: "var(--text-secondary)", textTransform: "uppercase", fontSize: 9, letterSpacing: "0.06em" }}>{region.spray_from_cars.replace(/_/g, " ")}</span>
        </div>
      </div>

      {/* CV metrics (only when we have them) */}
      {isCv && (region.specularity_score !== undefined || region.texture_entropy !== undefined) && (
        <div style={{ borderTop: "1px dashed rgba(255,255,255,0.07)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "#22c55e", textTransform: "uppercase", marginBottom: 2 }}>📊 CV Pixel Analysis</span>
          <CvMetricRow label="specularity" value={region.specularity_score} highlight={(region.specularity_score ?? 0) > 0.03} />
          <CvMetricRow label="tex. entropy" value={region.texture_entropy} />
          <CvMetricRow label="puddle ratio" value={region.dark_puddle_ratio} highlight={(region.dark_puddle_ratio ?? 0) > 0.05} />
          <CvMetricRow label="blue sat." value={region.blue_saturation} />
        </div>
      )}

      {/* Note */}
      {region.note && (
        <p style={{ fontSize: 10, fontStyle: "italic", color: "var(--text-dim)", margin: 0, lineHeight: 1.4, borderTop: "1px dashed rgba(255,255,255,0.07)", paddingTop: 6 }} title={region.note}>
          {region.note.length > 100 ? region.note.slice(0, 97) + "…" : region.note}
        </p>
      )}
    </div>
  );
}

export default function EvidencePanel({ frame, isProcessing = false }: { frame: DecisionFrame | null; isProcessing?: boolean }) {
  const lineEv = frame?.evidence?.line ?? null;
  const offLineEv = frame?.evidence?.off_line ?? null;
  const provider = frame?.provider;

  return (
    <div className="glass-panel p-4">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", color: "var(--text-secondary)", textTransform: "uppercase", margin: 0 }}>
          VLM Evidence
        </h2>
        {provider && (
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 3, background: "rgba(0,229,255,0.07)", color: "var(--cyan)", border: "1px solid rgba(0,229,255,0.2)" }}>
            {provider}
          </span>
        )}
      </div>

      {isProcessing ? (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--cyan)", display: "inline-block", animation: "pulse 1s infinite" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cyan)", letterSpacing: "0.08em" }}>PROCESSING FRAME…</span>
          </div>
        </div>
      ) : lineEv && offLineEv ? (
        <div style={{ display: "flex", gap: 12 }}>
          <RegionPanel label="A · On-Line" color={COLOR_LINE} region={lineEv} />
          <div style={{ width: 1, background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
          <RegionPanel label="B · Off-Line" color={COLOR_OFF_LINE} region={offLineEv} />
        </div>
      ) : (
        <div style={{ padding: "16px 0", textAlign: "center" }}>
          <p style={{ fontSize: 11, color: "var(--text-dim)", margin: 0 }}>
            {frame
              ? "⚠ No VLM evidence for this frame — stub mode or all providers failed."
              : "Waiting for first frame…"}
          </p>
        </div>
      )}
    </div>
  );
}
