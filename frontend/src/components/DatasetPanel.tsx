import { useEffect, useState } from "react";
import { getDatasetStats, datasetZipUrl } from "../api";

const LABEL_COLORS: Record<string, string> = {
  DRY: "#22c55e",
  DAMP: "#f59e0b",
  WET: "#3b82f6",
  DRYING: "#a855f7",
  LOW_CONFIDENCE: "#6b7280",
};

export default function DatasetPanel({ sessionId }: { sessionId: string | null }) {
  const [stats, setStats] = useState<{
    exists: boolean;
    total_frames?: number;
    line_crops?: number;
    off_line_crops?: number;
    label_distribution?: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function poll() {
      if (!sessionId) return;
      try {
        const s = await getDatasetStats(sessionId);
        if (!cancelled) setStats(s);
      } catch {
        // silently ignore polling errors
      }
    }

    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId]);

  if (!stats) return null;

  const total = stats.total_frames ?? 0;
  const dist = stats.label_distribution ?? {};
  const labels = Object.keys(dist);
  const maxCount = Math.max(1, ...Object.values(dist));

  return (
    <div className="glass-panel p-4 text-xs">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-semibold tracking-wider text-neutral-300">
            DATASET EXPORT
          </span>
          {total > 0 && (
            <span className="rounded-full bg-neon-purple-muted px-2.5 py-0.5 text-[10px] font-bold text-neon-purple ring-1 ring-neon-purple/50">
              {total} crops
            </span>
          )}
        </div>
        {sessionId && total > 0 && (
          <a
            href={datasetZipUrl(sessionId)}
            download={`dryline_dataset_${sessionId}.zip`}
            className="flex items-center gap-1 rounded border border-violet-700/60 bg-violet-950/50 px-2 py-1 font-medium text-violet-300 transition hover:border-violet-400 hover:text-violet-200"
          >
            <span>⬇</span>
            <span>Download ZIP</span>
          </a>
        )}
      </div>

      {!stats.exists || total === 0 ? (
        <p className="text-neutral-500 italic">
          No crops saved yet — ingest a frame or upload a video to start building the dataset.
        </p>
      ) : (
        <>
          {/* ROI crop counts */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded bg-neutral-900/70 p-2 text-center">
              <p className="text-lg font-black text-cyan-400">{stats.line_crops ?? 0}</p>
              <p className="text-[10px] uppercase tracking-widest text-neutral-500">On-Track crops</p>
            </div>
            <div className="rounded bg-neutral-900/70 p-2 text-center">
              <p className="text-lg font-black text-orange-400">{stats.off_line_crops ?? 0}</p>
              <p className="text-[10px] uppercase tracking-widest text-neutral-500">Off-Track crops</p>
            </div>
          </div>

          {/* Label distribution */}
          {labels.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-widest text-neutral-500">
                Label distribution
              </p>
              <div className="flex flex-col gap-1.5">
                {labels.map((lbl) => (
                  <div key={lbl} className="flex items-center gap-2">
                    <span
                      className="w-16 shrink-0 text-right text-[10px] font-bold uppercase tracking-wide"
                      style={{ color: LABEL_COLORS[lbl] ?? "#a1a1aa" }}
                    >
                      {lbl}
                    </span>
                    <div className="relative flex-1 overflow-hidden rounded-full bg-neutral-800 h-2">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                        style={{
                          width: `${(dist[lbl] / maxCount) * 100}%`,
                          backgroundColor: LABEL_COLORS[lbl] ?? "#a1a1aa",
                          opacity: 0.8,
                        }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right text-neutral-400">{dist[lbl]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Structure hint */}
          <p className="mt-3 text-[10px] text-neutral-600 leading-relaxed">
            ZIP contains <code className="text-neutral-500">line/</code> · <code className="text-neutral-500">off_line/</code> folders + <code className="text-neutral-500">labels.csv</code>
          </p>
        </>
      )}
    </div>
  );
}
