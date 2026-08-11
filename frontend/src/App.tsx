import { useEffect, useRef, useState } from "react";
import { createSession, genPlaceholderFrameBlob, postFrame } from "./api";
import type { DecisionFrame, RoiBox } from "./types";
import FramePanel from "./components/FramePanel";
import EvidencePanel from "./components/EvidencePanel";
import StatusChip from "./components/StatusChip";
import TrendChart from "./components/TrendChart";
import InsightPanel from "./components/InsightPanel";
import Footer from "./components/Footer";
import SessionSummary from "./components/SessionSummary";

// Matches backend/scripts/demo.sh Part 1: a full wet -> drying -> dry arc,
// tuned so the alpha-beta filter (alpha 0.15, beta 0.005) actually converges
// at this sample spacing. See CLAUDE.md / PLAN.md Phase 1 for why.
// lat/lon is Silverstone Circuit — gives the weather cross-check something
// real to compare against instead of sitting unavailable in the demo.
const DEMO_CONFIG = {
  name: "frontend-demo",
  lap_time_s: 90,
  initial_w: 0.8,
  drift_per_min: -0.045,
  sine_amp: 0.02,
  sine_period_s: 50,
  noise_std: 0.01,
  lag_s: 150,
  lat: 52.0786,
  lon: -1.0169,
};
const T_STEP = 10;
const T_MAX = 900;
const TICK_MS = 250;

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [roiBoxes, setRoiBoxes] = useState<{ line: RoiBox; off_line: RoiBox } | null>(null);
  const [lapTimeS, setLapTimeS] = useState(90);
  const [frames, setFrames] = useState<DecisionFrame[]>([]);
  const [playing, setPlaying] = useState(true);
  const [naiveMode, setNaiveMode] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [simT, setSimT] = useState(0);

  const simTRef = useRef(0);
  const blobRef = useRef<Blob | null>(null);
  const startingRef = useRef(false);

  async function startNewSession() {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      const resp = await createSession(DEMO_CONFIG);
      blobRef.current = await genPlaceholderFrameBlob();
      simTRef.current = 0;
      setSimT(0);
      setFrames([]);
      setUploadedImageUrl(null);
      setRoiBoxes(resp.roi_boxes);
      setLapTimeS((resp.config.lap_time_s as number) ?? 90);
      setSessionId(resp.id);
    } finally {
      startingRef.current = false;
    }
  }

  useEffect(() => {
    startNewSession();
  }, []);

  // Auto-play loop: advances simulated time and posts a synthetic frame every
  // tick. Loops forever by starting a fresh session once the arc completes —
  // this is meant to run unattended on a booth/projector.
  useEffect(() => {
    if (!playing || !sessionId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled || !blobRef.current) return;
      const nextT = simTRef.current + T_STEP;
      try {
        const frame = await postFrame(sessionId, blobRef.current, nextT);
        if (cancelled) return;
        simTRef.current = nextT;
        setSimT(nextT);
        setFrames((prev) => [...prev, frame]);
        if (nextT >= T_MAX) await startNewSession();
      } catch (e) {
        console.error(e);
      }
    }, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [playing, sessionId]);

  async function handleUpload(file: File) {
    if (!sessionId) return;
    setPlaying(false);
    setUploadedImageUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    const nextT = simTRef.current + T_STEP;
    try {
      const frame = await postFrame(sessionId, file, nextT);
      simTRef.current = nextT;
      setSimT(nextT);
      setFrames((prev) => [...prev, frame]);
    } catch (e) {
      console.error(e);
    }
  }

  const latest = frames.length ? frames[frames.length - 1] : null;
  const lowConfidence = latest ? !latest.confidence_ok : false;

  return (
    <div className="flex h-screen flex-col bg-carbon text-neutral-100">
      <header className="flex items-center gap-4 border-b border-neutral-800 px-5 py-3">
        <div>
          <h1 className="text-lg font-black tracking-tight">
            DRY<span className="text-cyan-400">LINE</span>
          </h1>
          <p className="text-[11px] uppercase tracking-widest text-neutral-500">
            live track condition detector
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
          <span>
            session <span className="font-mono text-neutral-400">{sessionId ?? "…"}</span>
          </span>
          <span>t = {(simT / 60).toFixed(1)} min</span>
          <SessionSummary sessionId={sessionId} />
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded border border-neutral-700 px-3 py-1.5 font-medium text-neutral-200 hover:border-cyan-400 hover:text-cyan-300"
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            onClick={() => {
              setPlaying(true);
              startNewSession();
            }}
            className="rounded border border-neutral-700 px-3 py-1.5 font-medium text-neutral-200 hover:border-cyan-400 hover:text-cyan-300"
          >
            ↺ Reset
          </button>
        </div>
      </header>

      <div
        className={`grid min-h-0 flex-1 grid-cols-[minmax(340px,38%)_1fr] gap-4 p-4 transition-all duration-500 ${
          lowConfidence ? "grayscale opacity-70" : ""
        }`}
      >
        <div className="grid min-h-0 grid-rows-[1fr_auto] gap-3">
          <FramePanel imageUrl={uploadedImageUrl} roiBoxes={roiBoxes} onUpload={handleUpload} />
          <EvidencePanel frame={latest} />
        </div>

        <div className="grid min-h-0 grid-rows-[auto_1fr_auto] gap-3">
          <div className="h-36">
            <StatusChip frame={latest} naiveMode={naiveMode} />
          </div>
          <TrendChart frames={frames} lapTimeS={lapTimeS} naiveMode={naiveMode} />
          <InsightPanel frame={latest} naiveMode={naiveMode} />
        </div>
      </div>

      <Footer frame={latest} sessionId={sessionId} naiveMode={naiveMode} onToggleNaive={() => setNaiveMode((n) => !n)} />
    </div>
  );
}
