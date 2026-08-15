import { useEffect, useRef, useState } from "react";
import {
  createSession,
  genPlaceholderFrameBlob,
  postFrame,
  listPrecomputed,
  getPrecomputedSeries,
  postBaselineFrame,
  exportSessionUrl,
  postVideo,
  exportCsvUrl,
} from "./api";
import { useWebcam } from "./hooks/useWebcam";
import type { DecisionFrame } from "./types";
import type { VideoUploadState } from "./components/FramePanel";
import FramePanel from "./components/FramePanel";
import EvidencePanel from "./components/EvidencePanel";
import StatusChip from "./components/StatusChip";
import TrendChart from "./components/TrendChart";
import InsightPanel from "./components/InsightPanel";
import Footer from "./components/Footer";
import SessionSummary from "./components/SessionSummary";
import DatasetPanel from "./components/DatasetPanel";
import InferenceLog from "./components/InferenceLog";

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

type NavTab = "telemetry" | "history" | "strategy" | "logs";

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lapTimeS, setLapTimeS] = useState(90);
  const [frames, setFrames] = useState<DecisionFrame[]>([]);
  const [playing, setPlaying] = useState(true);
  const [naiveMode, setNaiveMode] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [simT, setSimT] = useState(0);
  const [precomputedClips, setPrecomputedClips] = useState<string[]>([]);
  const [selectedClip, setSelectedClip] = useState<string>("roboflow_dataset_1.mp4");
  const [precomputedFrames, setPrecomputedFrames] = useState<DecisionFrame[]>([]);
  const [liveSingleInference, setLiveSingleInference] = useState(false);
  const [baselineLabel, setBaselineLabel] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoUploadState>({ status: "idle" });
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeNav, setActiveNav] = useState<NavTab>("telemetry");
  const [viewingFrame, setViewingFrame] = useState<DecisionFrame | null>(null);

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
        setPrecomputedFrames(res.frames);
        setFrames([]); // Clear screen, wait for play
        setSimT(0);
        simTRef.current = 0;
        setBaselineLabel(null);
      }).catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setLapTimeS((resp.config.lap_time_s as number) ?? 90);
      setSessionId(resp.id);
      return resp.id;
    } finally {
      startingRef.current = false;
    }
  }

  useEffect(() => {
    if (!playing || !sessionId) return;
    let cancelled = false;
    const tickDelay = selectedClip !== "live" ? 2000 : TICK_MS; // Faster playback for precomputed
    
    const interval = setInterval(async () => {
      if (cancelled) return;
      
      if (selectedClip !== "live") {
        setFrames((prev) => {
          if (prev.length < precomputedFrames.length) {
            const nextFrame = precomputedFrames[prev.length];
            setSimT(nextFrame.t);
            simTRef.current = nextFrame.t;
            return [...prev, nextFrame];
          } else {
            setPlaying(false);
            return prev;
          }
        });
        return;
      }

      const frameBlob = webcam.isActive ? await webcam.captureBlob() : blobRef.current;
      if (!frameBlob) return;
      const nextT = simTRef.current + T_STEP;
      try {
        const frame = await postFrame(sessionId, frameBlob, nextT);
        if (cancelled) return;
        simTRef.current = nextT;
        setSimT(nextT);
        setFrames((prev) => [...prev, frame]);
        if (nextT >= T_MAX && !webcam.isActive) await startNewSession();
      } catch (e) { console.error(e); }
    }, tickDelay);
    return () => { cancelled = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, sessionId, webcam.isActive, precomputedFrames, selectedClip]);

  async function handleUpload(file: File) {
    let currentSession = sessionId;
    if (selectedClip !== "live") {
      skipNextResetRef.current = true;
      setSelectedClip("live");
      currentSession = await startNewSession(true) ?? sessionId;
    }
    if (!currentSession) return;
    setPlaying(false);
    setUploadedImageUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
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
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); }
  }

  async function handleVideoUpload(file: File) {
    if (!sessionId) return;
    setPlaying(false); setSelectedClip("live"); setFrames([]);
    setUploadedImageUrl(null); simTRef.current = 0; setSimT(0);
    setVideoState({ status: "uploading", pct: 0 });
    try {
      const result = await postVideo(sessionId, file, 2.0, (pct) => setVideoState({ status: "uploading", pct }));
      setVideoState({ status: "processing" });
      const series = await fetch(`http://localhost:8000/session/${sessionId}/series`);
      if (series.ok) {
        const data = await series.json();
        setFrames(data.frames);
        const lastT = data.frames[data.frames.length - 1]?.t ?? 0;
        simTRef.current = lastT; setSimT(lastT);
      }
      setVideoState({ status: "done", framesIngested: result.frames_ingested });
    } catch (e) { setVideoState({ status: "error", message: String(e) }); }
  }

  async function handleWebcamStart() {
    if (!sessionId) await startNewSession();
    await webcam.start();
    setSelectedClip("live"); setFrames([]);
    simTRef.current = 0; setSimT(0); setPlaying(true);
  }

  function handleWebcamStop() { webcam.stop(); setPlaying(false); }

  const latest = frames.length ? frames[frames.length - 1] : null;

  // Format timestamp for display
  const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";
  const simTimeStr = (() => {
    const d = new Date(Date.now() - simT * 1000);
    return d.toISOString().slice(11, 23) + "Z";
  })();

  const currentImage = uploadedImageUrl || (frames.length > 0 ? frames[frames.length - 1]?.image_url ?? null : null);

  return (
    <div className="app-shell">
      {/* ── TOP BAR ─────────────────────────────────────────── */}
      <div className="topbar">
        <div className="topbar-left">
          <span>Pit Wall Config</span>
        </div>
        <div className="topbar-center">
          <div className="topbar-signal">
            <span /><span /><span />
          </div>
          <h1 className="topbar-title">Track Condition Detector</h1>
        </div>
        <div className="topbar-right">
          <button className="rec-btn">
            <span className="rec-dot" />
            REC
          </button>
          <button
            className="sim-btn"
            onClick={() => setPlaying(p => !p)}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M6 1v2M6 9v2M1 6h2M9 6h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            {playing ? "Pause Feed" : "Simulate Live Feed"}
          </button>
        </div>
      </div>

      {/* ── BODY ────────────────────────────────────────────── */}
      <div className="body-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <nav className="nav-list">
            {([
              { id: "telemetry", label: "Live Telemetry", icon: "📡" },
              { id: "history",   label: "Condition History", icon: "📈" },
              { id: "strategy",  label: "Strategy Hub", icon: "🏎" },
              { id: "logs",      label: "System Logs", icon: "📋" },
            ] as { id: NavTab; label: string; icon: string }[]).map(item => (
              <div
                key={item.id}
                className={`nav-item ${activeNav === item.id ? "active" : ""}`}
                onClick={() => setActiveNav(item.id)}
              >
                <span className="nav-icon" style={{ fontSize: 14 }}>{item.icon}</span>
                {item.label}
              </div>
            ))}
          </nav>

          {/* Sidebar controls */}
          <div className="sidebar-controls">
            <select
              value={selectedClip}
              onChange={e => setSelectedClip(e.target.value)}
              className="ctrl-select"
            >
              <option value="live">Live / Upload</option>
              {precomputedClips.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="ctrl-toggle">
              <input type="checkbox" checked={liveSingleInference} onChange={e => setLiveSingleInference(e.target.checked)} />
              Single Inference
            </label>
            <button
              className="ctrl-btn"
              onClick={() => { if (sessionId) window.location.href = exportSessionUrl(sessionId); }}
              disabled={!sessionId}
            >
              ↓ Export Session
            </button>
            {sessionId && (
              <a
                href={exportCsvUrl(sessionId)}
                download={`${sessionId}.csv`}
                className="ctrl-btn"
                style={{ display: "block", textDecoration: "none" }}
              >
                ↓ Export CSV
              </a>
            )}
            <button
              className="ctrl-btn danger"
              disabled={selectedClip !== "live"}
              onClick={() => {
                if (window.confirm("Delete entire session history?")) {
                  setFrames([]); setLapTimeS(90); setPlaying(true); startNewSession();
                }
              }}
            >
              ↺ Reset Session
            </button>
            <SessionSummary sessionId={sessionId} />
          </div>

          {/* Footer */}
          <div className="sidebar-footer">
            <div className="sys-status-dot">
              <span style={{ fontSize: 12, color: "var(--cyan)" }}>✓</span>
            </div>
            <div>
              <div className="sys-status-label">System OK</div>
              <div className="sys-status-ver">v2.4.1</div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="main-content">
          {activeNav === "telemetry" && (
            <TelemetryView
              frames={frames}
              latest={latest}
              naiveMode={naiveMode}
              baselineLabel={baselineLabel}
              isProcessing={isProcessing}
              lapTimeS={lapTimeS}
              simTimeStr={simTimeStr}
              currentImage={currentImage}
              videoState={videoState}
              webcam={webcam}
              onUpload={handleUpload}
              onVideoUpload={handleVideoUpload}
              onWebcamStart={handleWebcamStart}
              onWebcamStop={handleWebcamStop}
              onViewFrame={setViewingFrame}
              sessionId={sessionId}
              onToggleNaive={() => setNaiveMode(m => !m)}
            />
          )}
          {activeNav === "history" && (
            <ConditionHistoryView frames={frames} lapTimeS={lapTimeS} naiveMode={naiveMode} onToggleNaive={() => setNaiveMode(m => !m)} />
          )}
          {activeNav === "strategy" && (
            <StrategyView frame={latest} naiveMode={naiveMode} onToggleNaive={() => setNaiveMode(m => !m)} />
          )}
          {activeNav === "logs" && (
            <LogsView frame={latest} isProcessing={isProcessing} sessionId={sessionId} />
          )}
        </main>
      </div>



      {/* Frame viewer modal */}
      {viewingFrame && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setViewingFrame(null)}
        >
          <div
            className="glass-panel animate-fade-in"
            style={{ padding: 20, maxWidth: 640, width: "90%", maxHeight: "90vh", overflow: "auto" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontFamily: "Space Grotesk", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "var(--cyan)", textTransform: "uppercase" }}>
                Frame Detail
              </span>
              <button onClick={() => setViewingFrame(null)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            {viewingFrame.image_url && (
              <img src={viewingFrame.image_url} alt="frame" style={{ width: "100%", borderRadius: 4, marginBottom: 12, border: "1px solid var(--border)" }} />
            )}
            <EvidencePanel frame={viewingFrame} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Telemetry view (main dashboard) ─────────────────────────
function TelemetryView({
  frames, latest, naiveMode, baselineLabel, isProcessing, lapTimeS,
  simTimeStr, currentImage, videoState, webcam,
  onUpload, onVideoUpload, onWebcamStart, onWebcamStop,
  onViewFrame, sessionId, onToggleNaive,
}: {
  frames: DecisionFrame[];
  latest: DecisionFrame | null;
  naiveMode: boolean;
  baselineLabel: string | null;
  isProcessing: boolean;
  lapTimeS: number;
  simTimeStr: string;
  currentImage: string | null;
  videoState: VideoUploadState;
  webcam: ReturnType<typeof useWebcam>;
  onUpload: (f: File) => void;
  onVideoUpload: (f: File) => void;
  onWebcamStart: () => void;
  onWebcamStop: () => void;
  onViewFrame: (f: DecisionFrame) => void;
  sessionId: string | null;
  onToggleNaive: () => void;
}) {
  const pct = latest ? Math.round(latest.model_confidence * 100) : 0;
  const labelClass = latest ? latest.displayed_label.toLowerCase().replace("_", "_") : "dry";

  const crossoverText = latest?.crossover
    ? `${latest.crossover.eta_laps.toFixed(1)} laps → ${latest.crossover.target_compound}`
    : "No crossover predicted in next 15 minutes";

  const strategyText = latest
    ? latest.suggestion
    : "Optimal conditions for slick compounds. No cross-over point predicted in next 15 minutes. Maintain current stint plan.";

  const strategyTitle = latest
    ? (latest.displayed_label === "DRY" ? "Track Stable"
      : latest.displayed_label === "DAMP" ? "Caution – Damp"
      : latest.displayed_label === "WET" ? "Wet Track"
      : latest.displayed_label === "DRYING" ? "Track Drying"
      : "Low Confidence")
    : "Track Stable";

  const aiTelemetry = latest?.evidence?.line?.telemetry;
  const trackTemp = aiTelemetry ? aiTelemetry.track_temp_c.toFixed(1) : "--";
  const airTemp = aiTelemetry ? aiTelemetry.air_temp_c.toFixed(1) : "--";
  const humidity = aiTelemetry ? Math.round(aiTelemetry.humidity_pct) : "--";
  const rainProb = aiTelemetry ? Math.round(aiTelemetry.rain_prob_pct) : "--";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "minmax(280px,420px) 1fr",
      gridTemplateRows: "1fr auto auto",
      flex: 1,
      overflow: "hidden",
      gap: "1px",
      background: "var(--border)",
      height: "100%",
    }}>
      {/* ── LEFT COL: Camera + Sensor ─────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gridRow: "1 / 4", background: "rgba(7,10,14,0.82)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", overflow: "hidden" }}>
        {/* Camera Panel */}
        <div style={{ flex: "1 1 0", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <FramePanel
            imageUrl={currentImage}
            onUpload={onUpload}
            onVideoUpload={onVideoUpload}
            videoState={videoState}
            webcamVideoRef={webcam.videoRef}
            webcamActive={webcam.isActive}
            webcamError={webcam.error}
            onWebcamStart={onWebcamStart}
            onWebcamStop={onWebcamStop}
            simTimeStr={simTimeStr}
          />
        </div>

        {/* Sensor Data */}
        <div className="sensor-panel">
          <div className="panel-header" style={{ borderTop: "1px solid var(--border)" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="3" width="10" height="7" rx="1" stroke="var(--text-dim)" strokeWidth="1.2"/>
              <path d="M4 3V2a2 2 0 014 0v1" stroke="var(--text-dim)" strokeWidth="1.2"/>
            </svg>
            <span className="panel-label">Local Sensor Data</span>
          </div>
          <div className="sensor-grid">
            <div className="sensor-cell">
              <div className="sensor-label">Track Temp</div>
              <div className="sensor-value">{trackTemp}<span className="sensor-unit">°C</span></div>
            </div>
            <div className="sensor-cell">
              <div className="sensor-label">Air Temp</div>
              <div className="sensor-value">{airTemp}<span className="sensor-unit">°C</span></div>
            </div>
            <div className="sensor-cell" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="sensor-label">Humidity</div>
              <div className="sensor-value">{humidity}<span className="sensor-unit">%</span></div>
            </div>
            <div className="sensor-cell" style={{ borderTop: "1px solid var(--border)", borderLeft: "1px solid var(--border)" }}>
              <div className="sensor-label">Rain Prob.</div>
              <div className="sensor-value highlight">{rainProb}<span className="sensor-unit">%</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT TOP: AI Classification + Strategy ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "var(--border)", flexShrink: 0 }}>
        {/* AI Classification */}
        <div className="ai-panel">
          <div className="ai-panel-label">AI Condition Classification</div>
          <div className="ai-condition-row">
            {/* Condition icon */}
            <ConditionIcon label={latest?.displayed_label ?? "DRY"} />
            <span className={`condition-label-big ${labelClass}`}>
              {isProcessing ? "…" : (latest?.displayed_label ?? "DRY")}
            </span>
            <div className="confidence-ring">{pct}</div>
          </div>
          <div className="confidence-bar-row">
            <div className="confidence-bar-track">
              <div className="confidence-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="confidence-label">{pct}% Confidence</div>
          </div>
        </div>

        {/* Strategy Suggestion */}
        <div className="strategy-panel">
          <div className="strategy-panel-label">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <polygon points="6,1 11,10 1,10" stroke="var(--text-dim)" strokeWidth="1.2" fill="none"/>
              <path d="M6 5v2.5" stroke="var(--text-dim)" strokeWidth="1.2" strokeLinecap="round"/>
              <circle cx="6" cy="9" r="0.6" fill="var(--text-dim)"/>
            </svg>
            Strategy Suggestion
          </div>
          <div className="strategy-title">{strategyTitle}</div>
          <div className="strategy-body">{strategyText}</div>
        </div>
      </div>

      {/* ── AI VISUAL EVIDENCE (Gloss, Wetness, etc.) ── */}
      <div style={{ gridColumn: "2", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <EvidencePanel frame={latest} isProcessing={isProcessing} />
      </div>

      {/* ── RIGHT MID: Trend Chart ─────────────────── */}
      <div className="chart-panel">
        <div className="chart-header">
          <div className="chart-label">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <polyline points="1,9 4,5 7,7 11,2" stroke="var(--text-secondary)" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
            </svg>
            Condition Confidence Trend
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Footer
              frame={latest}
              sessionId={sessionId}
              naiveMode={naiveMode}
              onToggleNaive={onToggleNaive}
              compact
            />
          </div>
        </div>
        <div className="chart-body">
          <TrendChart frames={frames} lapTimeS={lapTimeS} naiveMode={naiveMode} />
        </div>
      </div>

      {/* ── BOTTOM: Inference Log ──────────────────── */}
      <div style={{ gridColumn: "2", borderTop: "1px solid var(--border)", background: "var(--bg-panel)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 200 }}>
        <InferenceLog frames={frames} onViewFrame={onViewFrame} />
      </div>
    </div>
  );
}

function ConditionIcon({ label }: { label: string }) {
  const l = label.toUpperCase();
  if (l === "DRY") return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="7" fill="rgba(0,229,255,0.15)" stroke="#00e5ff" strokeWidth="1.5"/>
      <path d="M16 6v3M16 23v3M6 16h3M23 16h3M8.9 8.9l2.1 2.1M20.9 20.9l2.1 2.1M8.9 23.1l2.1-2.1M20.9 11.1l2.1-2.1" stroke="#00e5ff" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
  if (l === "WET") return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path d="M16 6C16 6 8 16 8 20a8 8 0 0016 0c0-4-8-14-8-14z" fill="rgba(96,165,250,0.15)" stroke="#60a5fa" strokeWidth="1.5"/>
    </svg>
  );
  if (l === "DAMP") return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path d="M16 8C16 8 10 16 10 19a6 6 0 0012 0c0-3-6-11-6-11z" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth="1.5"/>
      <path d="M16 6v3M8 16h3" stroke="#f59e0b" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
  if (l === "DRYING") return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path d="M16 8C16 8 10 16 10 19a6 6 0 0012 0c0-3-6-11-6-11z" fill="rgba(167,139,250,0.15)" stroke="#a78bfa" strokeWidth="1.5"/>
      <path d="M16 6v3M25 16h-3" stroke="#a78bfa" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="8" fill="rgba(239,68,68,0.1)" stroke="#ef4444" strokeWidth="1.5"/>
      <path d="M16 10v7M16 21v1" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// ── Condition History View ───────────────────────────────────
function ConditionHistoryView({
  frames, lapTimeS, naiveMode, onToggleNaive,
}: {
  frames: DecisionFrame[];
  lapTimeS: number;
  naiveMode: boolean;
  onToggleNaive: () => void;
}) {
  const LABEL_COLOR: Record<string, string> = {
    DRY: "#00e5ff", DAMP: "#f59e0b", WET: "#60a5fa",
    DRYING: "#a78bfa", LOW_CONFIDENCE: "#ef4444",
  };

  // Compute label transitions from frames
  const transitions: { t: number; label: string; duration: number }[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const label = f.displayed_label;
    if (i === 0 || frames[i - 1].displayed_label !== label) {
      const nextChange = frames.slice(i + 1).findIndex(nf => nf.displayed_label !== label);
      const duration = nextChange === -1
        ? (frames[frames.length - 1].t - f.t)
        : (frames[i + 1 + nextChange - 1]?.t ?? f.t) - f.t;
      transitions.push({ t: f.t, label, duration: Math.max(duration, 0) });
    }
  }

  const totalT = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-base)" }}>
      {/* Page header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px", borderBottom: "1px solid var(--border)",
        flexShrink: 0, background: "var(--bg-panel)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: "Space Grotesk", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
            📈 Condition History
          </span>
          {frames.length > 0 && (
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--text-dim)" }}>
              {frames.length} frames · {(totalT / 60).toFixed(1)} min session
            </span>
          )}
        </div>
        <button
          onClick={onToggleNaive}
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "4px 12px", borderRadius: 3, border: "1px solid",
            cursor: "pointer", transition: "all 0.15s",
            borderColor: naiveMode ? "rgba(245,166,35,0.6)" : "var(--border)",
            background: naiveMode ? "rgba(245,166,35,0.08)" : "transparent",
            color: naiveMode ? "#f5a623" : "var(--text-dim)",
          }}
        >
          Naive A/B: {naiveMode ? "ON" : "OFF"}
        </button>
      </div>

      {/* Content */}
      {frames.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <polyline points="4,36 16,20 28,28 44,8" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" fill="none" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontFamily: "Space Grotesk", fontSize: 13, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            No session data yet
          </span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Switch to Live Telemetry and start a session to see history</span>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: 0, minHeight: 0 }}>
          {/* Chart — takes majority of space */}
          <div style={{ flex: "1 1 0", minHeight: 0, padding: "12px 8px 4px 0", position: "relative" }}>
            <TrendChart frames={frames} lapTimeS={lapTimeS} naiveMode={naiveMode} />
          </div>

          {/* Label timeline bar */}
          <div style={{ flexShrink: 0, padding: "0 24px 12px", background: "var(--bg-panel)", borderTop: "1px solid var(--border)" }}>
            <div style={{ padding: "10px 0 6px", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-dim)", textTransform: "uppercase" }}>
              Label Timeline
            </div>
            {totalT > 0 && (
              <div style={{ display: "flex", height: 24, borderRadius: 3, overflow: "hidden", width: "100%" }}>
                {transitions.map((tr, i) => {
                  const widthPct = ((tr.t - frames[0].t + tr.duration) / totalT * 100) - (tr.t - frames[0].t) / totalT * 100;
                  const leftPct = (tr.t - frames[0].t) / totalT * 100;
                  return (
                    <div
                      key={i}
                      title={`${tr.label} @ t=${(tr.t / 60).toFixed(1)}min`}
                      style={{
                        position: "absolute",
                        left: `${leftPct}%`,
                        width: `${Math.max(widthPct, 0.5)}%`,
                        height: 24,
                        background: `${LABEL_COLOR[tr.label] ?? "#6b7280"}33`,
                        borderLeft: `2px solid ${LABEL_COLOR[tr.label] ?? "#6b7280"}`,
                        display: "flex", alignItems: "center",
                        paddingLeft: 4, overflow: "hidden",
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: 8, fontWeight: 700,
                        letterSpacing: "0.06em", color: LABEL_COLOR[tr.label] ?? "#6b7280",
                        textTransform: "uppercase", whiteSpace: "nowrap",
                      }}
                    >
                      {widthPct > 4 ? tr.label : ""}
                    </div>
                  );
                })}
              </div>
            )}
            {totalT > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 8, fontFamily: "JetBrains Mono, monospace", color: "var(--text-dim)" }}>
                <span>0:00</span>
                <span>{(totalT / 60 / 2).toFixed(1)}m</span>
                <span>{(totalT / 60).toFixed(1)}m</span>
              </div>
            )}
          </div>

          {/* Label transition summary table */}
          <div style={{ flexShrink: 0, borderTop: "1px solid var(--border)", maxHeight: 180, overflow: "auto" }}>
            <div style={{ padding: "8px 24px 4px", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-dim)", textTransform: "uppercase" }}>
              Condition Transitions — {transitions.length} event{transitions.length !== 1 ? "s" : ""}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-panel)" }}>
                  {["Time", "Condition", "Duration", "Wetness (line)", "Rate"].map(h => (
                    <th key={h} style={{ padding: "5px 24px", textAlign: "left", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-dim)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transitions.map((tr, i) => {
                  const frame = frames.find(f => f.t >= tr.t);
                  const color = LABEL_COLOR[tr.label] ?? "#6b7280";
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 24px", fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--text-primary)" }}>
                        {(tr.t / 60).toFixed(1)}m
                      </td>
                      <td style={{ padding: "6px 24px" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 7px", borderRadius: 2,
                          fontFamily: "JetBrains Mono, monospace", fontSize: 9, fontWeight: 700,
                          letterSpacing: "0.06em", textTransform: "uppercase",
                          color, border: `1px solid ${color}44`, background: `${color}12`,
                        }}>
                          {tr.label}
                        </span>
                      </td>
                      <td style={{ padding: "6px 24px", fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--text-secondary)" }}>
                        {tr.duration > 0 ? `${tr.duration}s` : "—"}
                      </td>
                      <td style={{ padding: "6px 24px", fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--text-secondary)" }}>
                        {frame ? frame.w_line.toFixed(3) : "—"}
                      </td>
                      <td style={{ padding: "6px 24px", fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: frame && frame.rate_line_per_min < 0 ? "#22d3ee" : frame && frame.rate_line_per_min > 0 ? "#f59e0b" : "var(--text-secondary)" }}>
                        {frame ? `${frame.rate_line_per_min >= 0 ? "+" : ""}${frame.rate_line_per_min.toFixed(3)} W/m` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Strategy Hub View ────────────────────────────────────────
function StrategyView({
  frame, naiveMode, onToggleNaive,
}: {
  frame: DecisionFrame | null;
  naiveMode: boolean;
  onToggleNaive: () => void;
}) {
  const getCompoundColor = (type: string, active: boolean) => {
    if (!active) return "var(--text-dim)";
    if (type === "SLICK") return "#ef4444"; // Red for softs
    if (type === "INTER") return "#22c55e"; // Green for inters
    return "#3b82f6"; // Blue for wets
  };

  const aiTelemetry = frame?.evidence?.line?.telemetry;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-base)" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)", flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: "Space Grotesk", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
            🏎 Strategy Hub
          </span>
        </div>
        <button
          onClick={onToggleNaive}
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "4px 12px", borderRadius: 3, border: "1px solid",
            cursor: "pointer", transition: "all 0.15s",
            borderColor: naiveMode ? "rgba(245,166,35,0.6)" : "var(--border)",
            background: naiveMode ? "rgba(245,166,35,0.08)" : "transparent",
            color: naiveMode ? "#f5a623" : "var(--text-dim)",
          }}
        >
          Naive A/B: {naiveMode ? "ON" : "OFF"}
        </button>
      </div>

      {/* Main Content Scrollable Area */}
      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1200, margin: "0 auto" }}>
          
          {/* Top Row: The existing Insight Panel */}
          <div>
            <h2 style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.15em", color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 12 }}>
              Current Analysis
            </h2>
            <InsightPanel frame={frame} naiveMode={naiveMode} />
          </div>

          {!naiveMode && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              
              {/* Left Col: Tire Suitability */}
              <div className="panel" style={{ background: "rgba(8,12,18,0.4)", border: "1px solid var(--border)", borderRadius: 6 }}>
                <div className="panel-header">
                  <span className="panel-label">Tire Compound Suitability</span>
                </div>
                <div className="panel-body" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                  {[
                    { name: "SLICK (Soft)", score: Math.max(0, 100 - ((frame?.w_line ?? 0) * 300)), color: "#ef4444" },
                    { name: "INTERMEDIATE", score: (frame?.w_line ?? 0) < 0.2 ? (frame?.w_line ?? 0) * 250 : (frame?.w_line ?? 0) > 0.7 ? Math.max(0, 100 - ((frame?.w_line ?? 0) - 0.7) * 200) : 100, color: "#22c55e" },
                    { name: "FULL WET", score: (frame?.w_line ?? 0) < 0.5 ? 0 : Math.min(100, ((frame?.w_line ?? 0) - 0.5) * 200), color: "#3b82f6" }
                  ].map(tire => (
                    <div key={tire.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", color: tire.score > 50 ? "var(--text-primary)" : "var(--text-dim)" }}>
                        <span>{tire.name}</span>
                        <span>{tire.score.toFixed(0)}%</span>
                      </div>
                      <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ 
                          height: "100%", width: `${tire.score}%`, 
                          background: tire.color, 
                          boxShadow: tire.score > 50 ? `0 0 10px ${tire.color}88` : "none",
                          transition: "width 0.5s ease-out" 
                        }} />
                      </div>
                    </div>
                  ))}
                  
                  <div style={{ marginTop: 12, paddingTop: 16, borderTop: "1px dashed var(--border)", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    <strong style={{ color: "var(--cyan)" }}>System Note:</strong> Suitability is calculated based on current track surface wetness ({ ((frame?.w_line ?? 0) * 100).toFixed(1) }%) and divergence rate. Crossover delta is continuously monitored.
                  </div>
                </div>
              </div>

              {/* Right Col: Crossover & Grip Simulation */}
              <div className="panel" style={{ background: "rgba(8,12,18,0.4)", border: "1px solid var(--border)", borderRadius: 6 }}>
                <div className="panel-header">
                  <span className="panel-label">Crossover & Grip Simulation</span>
                </div>
                <div className="panel-body" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                  
                  <div style={{ display: "flex", gap: 24, paddingBottom: 16, borderBottom: "1px dashed var(--border)" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 4 }}>Est. Crossover Window</div>
                      <div style={{ fontFamily: "Space Grotesk", fontSize: 24, fontWeight: 700, color: frame?.crossover ? "var(--cyan)" : "var(--text-secondary)" }}>
                        {frame?.crossover ? `${frame.crossover.eta_laps.toFixed(1)} LAPS` : "NONE"}
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 4 }}>Target Compound</div>
                      <div style={{ fontFamily: "Space Grotesk", fontSize: 24, fontWeight: 700, color: frame?.crossover ? getCompoundColor(frame.crossover.target_compound, true) : "var(--text-secondary)" }}>
                        {frame?.crossover?.target_compound ?? "—"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, justifyContent: "center" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Track Grip Level</span>
                      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: "var(--text-primary)", fontWeight: 600 }}>
                        { aiTelemetry ? `${aiTelemetry.grip_level_pct.toFixed(1)}%` : "Awaiting AI..." }
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Water Dispersion Needs</span>
                      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: "var(--text-primary)", fontWeight: 600 }}>
                        { aiTelemetry ? `${aiTelemetry.water_dispersion_needs_ls.toFixed(1)} L/s` : "Awaiting AI..." }
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Temperature Risk</span>
                      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: aiTelemetry?.temperature_risk.includes("HIGH") ? "#f59e0b" : "#22c55e", fontWeight: 600 }}>
                        { aiTelemetry ? aiTelemetry.temperature_risk : "Awaiting AI..." }
                      </span>
                    </div>
                  </div>

                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── System Logs View ─────────────────────────────────────────
function LogsView({
  frame, isProcessing, sessionId,
}: {
  frame: DecisionFrame | null;
  isProcessing: boolean;
  sessionId: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "auto", gap: 0, background: "var(--bg-base)" }}>
      <div style={{
        padding: "10px 20px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)", flexShrink: 0,
      }}>
        <span style={{ fontFamily: "Space Grotesk", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          📋 System Logs — VLM Evidence & Dataset
        </span>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <EvidencePanel frame={frame} isProcessing={isProcessing} />
        <DatasetPanel sessionId={sessionId} />
      </div>
    </div>
  );
}

