import { useEffect, useRef, useState } from "react";
import { createSession, genPlaceholderFrameBlob, postFrame, listPrecomputed, getPrecomputedSeries, postBaselineFrame, exportSessionUrl, postVideo } from "./api";
import { useWebcam } from "./hooks/useWebcam";
import type { DecisionFrame, RoiBox } from "./types";
import type { VideoUploadState } from "./components/FramePanel";
import FramePanel from "./components/FramePanel";
import EvidencePanel from "./components/EvidencePanel";
import StatusChip from "./components/StatusChip";
import TrendChart from "./components/TrendChart";
import InsightPanel from "./components/InsightPanel";
import Footer from "./components/Footer";
import SessionSummary from "./components/SessionSummary";
import ROISelector from "./components/ROISelector";
import DatasetPanel from "./components/DatasetPanel";

// Matches backend/scripts/demo.sh's arc: a full wet -> drying -> dry sweep,
// tuned so the alpha-beta filter (alpha 0.15, beta 0.005) actually converges
// at this sample spacing.
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
const TICK_MS = 4000;

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [roiBoxes, setRoiBoxes] = useState<{ line: RoiBox; off_line: RoiBox } | null>(null);
  const [lapTimeS, setLapTimeS] = useState(90);
  const [frames, setFrames] = useState<DecisionFrame[]>([]);
  const [playing, setPlaying] = useState(true);
  const [naiveMode, setNaiveMode] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [simT, setSimT] = useState(0);
  const [precomputedClips, setPrecomputedClips] = useState<string[]>([]);
  const [selectedClip, setSelectedClip] = useState<string>("roboflow_dataset_1.mp4");
  const [liveSingleInference, setLiveSingleInference] = useState(false);
  const [baselineLabel, setBaselineLabel] = useState<string | null>(null);
  const [showRoi, setShowRoi] = useState(false);
  const [videoState, setVideoState] = useState<VideoUploadState>({ status: "idle" });
  const [isProcessing, setIsProcessing] = useState(false);

  // Webcam
  const webcam = useWebcam();

  const simTRef = useRef(0);
  const blobRef = useRef<Blob | null>(null);
  const startingRef = useRef(false);
  const skipNextResetRef = useRef(false);

  useEffect(() => {
    listPrecomputed().then(res => setPrecomputedClips(res.clips)).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedClip === "live") {
      if (skipNextResetRef.current) {
        skipNextResetRef.current = false;
      } else {
        startNewSession();
      }
    } else {
      setPlaying(false);
      getPrecomputedSeries(selectedClip).then(res => {
        setSessionId(res.id);
        setFrames(res.frames);
        setSimT(res.frames[res.frames.length - 1]?.t || 0);
        setBaselineLabel(null);
      }).catch(console.error);
    }
  }, [selectedClip]);

  async function startNewSession(keepImage = false) {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      const resp = await createSession(DEMO_CONFIG);
      blobRef.current = await genPlaceholderFrameBlob();
      simTRef.current = 0;
      setSimT(0);
      setFrames([]);
      if (!keepImage) setUploadedImageUrl(null);
      setRoiBoxes(resp.roi_boxes);
      setLapTimeS((resp.config.lap_time_s as number) ?? 90);
      setSessionId(resp.id);
      return resp.id;
    } finally {
      startingRef.current = false;
    }
  }

  // Auto-play loop: each tick either captures a webcam frame (real data) or
  // falls back to the synthetic placeholder blob (stub/demo mode).
  useEffect(() => {
    if (!playing || !sessionId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;

      // Prefer live webcam frame; fall back to placeholder blob
      const frameBlob = webcam.isActive
        ? await webcam.captureBlob()
        : blobRef.current;

      if (!frameBlob) return;

      const nextT = simTRef.current + T_STEP;
      try {
        const frame = await postFrame(sessionId, frameBlob, nextT);
        if (cancelled) return;
        simTRef.current = nextT;
        setSimT(nextT);
        setFrames((prev) => [...prev, frame]);
        if (nextT >= T_MAX && !webcam.isActive) await startNewSession();
      } catch (e) {
        console.error(e);
      }
    }, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, sessionId, webcam.isActive]);

  async function handleUpload(file: File) {
    let currentSession = sessionId;
    if (selectedClip !== "live") {
      skipNextResetRef.current = true;
      setSelectedClip("live");
      currentSession = await startNewSession(true) ?? sessionId;
    }
    if (!currentSession) return;
    setPlaying(false);
    
    setUploadedImageUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    const nextT = simTRef.current + T_STEP;
    setIsProcessing(true);
    try {
      if (liveSingleInference || naiveMode) {
        const bl = await postBaselineFrame(currentSession, file, nextT);
        setBaselineLabel(bl.label);
      }
      
      if (!liveSingleInference) {
        const frame = await postFrame(currentSession, file, nextT);
        simTRef.current = nextT;
        setSimT(nextT);
        setFrames((prev) => [...prev, frame]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleVideoUpload(file: File) {
    if (!sessionId) return;
    setPlaying(false);
    setSelectedClip("live");
    setFrames([]);
    setUploadedImageUrl(null);
    simTRef.current = 0;
    setSimT(0);
    setVideoState({ status: "uploading", pct: 0 });
    try {
      setVideoState({ status: "uploading", pct: 0 });
      const result = await postVideo(sessionId, file, 2.0, (pct) =>
        setVideoState({ status: "uploading", pct })
      );
      setVideoState({ status: "processing" });
      // After upload completes the backend returns processed frames count.
      // Fetch the full series so the chart populates.
      const series = await fetch(`http://localhost:8000/session/${sessionId}/series`);
      if (series.ok) {
        const data = await series.json();
        setFrames(data.frames);
        const lastT = data.frames[data.frames.length - 1]?.t ?? 0;
        simTRef.current = lastT;
        setSimT(lastT);
      }
      setVideoState({ status: "done", framesIngested: result.frames_ingested });
    } catch (e) {
      setVideoState({ status: "error", message: String(e) });
    }
  }

  async function handleWebcamStart() {
    // Make sure we have a session running before starting capture
    if (!sessionId) await startNewSession();
    await webcam.start();
    setSelectedClip("live");
    setFrames([]);
    simTRef.current = 0;
    setSimT(0);
    setPlaying(true);
  }

  function handleWebcamStop() {
    webcam.stop();
    setPlaying(false);
  }

  const latest = frames.length ? frames[frames.length - 1] : null;
  const lowConfidence = latest ? !latest.confidence_ok : false;

  return (
    <div className="flex min-h-screen flex-col bg-carbon text-neutral-100">
      <header className="flex shrink-0 items-center gap-4 border-b border-white/5 bg-black/20 backdrop-blur-xl px-6 py-4 shadow-panel z-50 sticky top-0">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tighter">
            DRY<span className="text-neon-cyan drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]">LINE</span>
          </h1>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-500 mt-0.5">
            live track condition detector
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3 text-xs text-neutral-500">
          <select 
            value={selectedClip} 
            onChange={e => setSelectedClip(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-neutral-300 backdrop-blur-md outline-none focus:border-neon-cyan transition-colors"
          >
            <option value="live">Live / Upload (Auto-play)</option>
            {precomputedClips.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="flex items-center gap-2 px-2 hover:text-neon-cyan transition-colors cursor-pointer">
            <input type="checkbox" className="accent-neon-cyan" checked={liveSingleInference} onChange={e => setLiveSingleInference(e.target.checked)} />
            Single Inference
          </label>
          <span className="opacity-60 border-l border-white/10 pl-3">
            session <span className="font-mono text-neon-purple">{sessionId ?? "…"}</span>
          </span>
          <span className="opacity-60">t = {(simT / 60).toFixed(1)} min</span>
          <SessionSummary sessionId={sessionId} />
          <button
            onClick={() => setShowRoi(true)}
            className="rounded-lg border border-white/10 px-4 py-1.5 font-medium text-neutral-200 transition-all duration-300 hover:border-neon-cyan hover:bg-neon-cyan-muted hover:shadow-neon-cyan"
          >
            ⊞ Calibrate
          </button>
          {sessionId && (
            <a
              href={exportSessionUrl(sessionId)}
              download={`${sessionId}.json`}
              className="rounded-lg border border-white/10 px-4 py-1.5 font-medium text-neutral-200 transition-all duration-300 hover:border-neon-cyan hover:bg-neon-cyan-muted hover:shadow-neon-cyan flex items-center justify-center"
            >
              ↓ Export
            </a>
          )}
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded-lg border border-white/10 px-4 py-1.5 font-medium text-neutral-200 transition-all duration-300 hover:border-neon-cyan hover:bg-neon-cyan-muted hover:shadow-neon-cyan"
            disabled={selectedClip !== "live"}
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            onClick={() => {
              if (selectedClip === "live") {
                if (window.confirm("Delete entire session history?")) {
                  setFrames([]);
                  setLapTimeS(90);
                  setPlaying(true);
                  startNewSession();
                }
              }
            }}
            className="rounded-lg border border-white/10 px-4 py-1.5 font-medium text-neutral-200 transition-all duration-300 hover:border-neon-cyan hover:bg-neon-cyan-muted hover:shadow-neon-cyan"
            disabled={selectedClip !== "live"}
          >
            ↺ Reset
          </button>
        </div>
      </header>

      <div className="flex flex-col xl:flex-row flex-1 gap-6 p-4 md:p-6 transition-all duration-500 w-full max-w-[1800px] mx-auto">
        {/* Left Column */}
        <div
          className={`flex flex-col gap-4 w-full xl:w-[40%] xl:min-w-[450px] transition-all duration-500 ${
            lowConfidence ? "grayscale opacity-70" : ""
          }`}
        >
          <div className="min-h-[350px] xl:h-[45vh] flex flex-col shrink-0">
            <FramePanel
              imageUrl={uploadedImageUrl || (frames.length > 0 ? frames[frames.length - 1]?.image_url ?? null : null)}
              roiBoxes={roiBoxes}
              onUpload={handleUpload}
              onVideoUpload={handleVideoUpload}
              videoState={videoState}
              webcamVideoRef={webcam.videoRef}
              webcamActive={webcam.isActive}
              webcamError={webcam.error}
              onWebcamStart={handleWebcamStart}
              onWebcamStop={handleWebcamStop}
            />
          </div>
          <EvidencePanel frame={latest} isProcessing={isProcessing} />
          <DatasetPanel sessionId={sessionId} />
        </div>

        {/* Right Column */}
        <div
          className={`flex flex-col gap-4 flex-1 min-w-0 transition-all duration-500 ${
            lowConfidence ? "grayscale opacity-70" : ""
          }`}
        >
          <div className="h-36 shrink-0">
            <StatusChip frame={latest} naiveMode={naiveMode} baselineLabel={baselineLabel} isProcessing={isProcessing} />
          </div>
          <div className="min-h-[350px] xl:h-[45vh] flex flex-col shrink-0">
            <TrendChart frames={frames} lapTimeS={lapTimeS} naiveMode={naiveMode} />
          </div>
          <InsightPanel frame={latest} naiveMode={naiveMode} />
        </div>
      </div>

      <div className="shrink-0 z-20">
        <Footer
          frame={latest}
          sessionId={sessionId}
          naiveMode={naiveMode}
          onToggleNaive={() => setNaiveMode((m) => !m)}
        />
      </div>

      {showRoi && (
        <ROISelector
          sessionId={sessionId}
          onApply={(newBoxes, file) => {
            setRoiBoxes(newBoxes);
            if (file) {
              handleUpload(file);
            }
          }}
          onClose={() => setShowRoi(false)}
        />
      )}
    </div>
  );
}
