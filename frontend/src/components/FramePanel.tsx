import { useRef, useState } from "react";
import type { RoiBox } from "../types";
import { COLOR_LINE, COLOR_OFF_LINE } from "../theme";

function RoiOverlay({ box, color, label }: { box: RoiBox; color: string; label: string }) {
  const [x, y, w, h] = box;
  return (
    <div
      className="absolute flex items-start justify-start"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
        border: `2px solid ${color}`,
        backgroundColor: `${color}22`,
        boxShadow: `0 0 12px ${color}55 inset`,
      }}
    >
      <span
        className="-translate-y-1/2 translate-x-2 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-black"
        style={{ backgroundColor: color }}
      >
        {label}
      </span>
    </div>
  );
}

export type VideoUploadState =
  | { status: "idle" }
  | { status: "uploading"; pct: number }
  | { status: "processing" }
  | { status: "done"; framesIngested: number }
  | { status: "error"; message: string };

export default function FramePanel({
  imageUrl,
  roiBoxes,
  onUpload,
  onVideoUpload,
  videoState,
  // Webcam props — passed from App.tsx which owns the useWebcam hook
  webcamVideoRef,
  webcamActive,
  webcamError,
  onWebcamStart,
  onWebcamStop,
}: {
  imageUrl: string | null;
  roiBoxes: { line: RoiBox; off_line: RoiBox } | null;
  onUpload: (file: File) => void;
  onVideoUpload: (file: File) => void;
  videoState: VideoUploadState;
  webcamVideoRef: React.RefObject<HTMLVideoElement | null>;
  webcamActive: boolean;
  webcamError: string | null;
  onWebcamStart: () => void;
  onWebcamStop: () => void;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const isVideoBusy = videoState.status === "uploading" || videoState.status === "processing";
  // Show webcam feed if active (takes priority over uploaded image)
  const showWebcam = webcamActive;
  const showImage = !webcamActive && !!imageUrl;

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type.startsWith("video/")) {
      onVideoUpload(file);
    } else if (file.type.startsWith("image/")) {
      onUpload(file);
    }
  }

  return (
    <div className="glass-panel flex h-full min-h-0 flex-col p-4 shadow-panel">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold tracking-wider text-neutral-300">
          CAMERA FRAME
        </h2>
        <div className="flex gap-1.5">
          {/* Webcam button */}
          {!webcamActive ? (
            <button
              onClick={onWebcamStart}
              disabled={isVideoBusy}
              title="Start live webcam"
              className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-medium text-neutral-300 hover:border-emerald-400 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Webcam
            </button>
          ) : (
            <button
              onClick={onWebcamStop}
              title="Stop webcam"
              className="flex items-center gap-1 rounded border border-red-700 bg-red-950/40 px-2 py-1 text-xs font-medium text-red-400 hover:border-red-400 hover:text-red-300"
            >
              ■ Stop
            </button>
          )}

          {/* Image upload */}
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={isVideoBusy || webcamActive}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-medium text-neutral-300 hover:border-cyan-400 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            📷 Image
          </button>

          {/* Video upload */}
          <button
            onClick={() => videoInputRef.current?.click()}
            disabled={isVideoBusy || webcamActive}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-medium text-neutral-300 hover:border-violet-400 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            🎬 Video
          </button>
        </div>

        <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
        <input ref={videoInputRef} type="file" accept="video/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onVideoUpload(f); e.target.value = ""; }} />
      </div>

      {/* Frame area */}
      <div
        className={`relative flex-1 overflow-hidden rounded-xl border transition-all duration-300 ${
          dragging ? "border-neon-purple shadow-[0_0_20px_rgba(176,38,255,0.2)_inset]" : webcamActive ? "border-neon-cyan shadow-[0_0_20px_rgba(0,240,255,0.2)_inset]" : "border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.8)_inset]"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {/* Webcam live preview — always rendered so the ref attaches, hidden when inactive */}
        <video
          ref={webcamVideoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${showWebcam ? "block" : "hidden"}`}
        />

        {/* Static uploaded image */}
        {showImage && (
          <img src={imageUrl!} alt="uploaded trackside frame" className="h-full w-full object-cover" />
        )}

        {/* Placeholder */}
        {!showWebcam && !showImage && <div className="track-placeholder h-full w-full" />}

        {/* ROI overlays */}
        {roiBoxes && (
          <>
            <RoiOverlay box={roiBoxes.line} color={COLOR_LINE} label="ON-LINE" />
            <RoiOverlay box={roiBoxes.off_line} color={COLOR_OFF_LINE} label="OFF-LINE" />
          </>
        )}

        {/* Drag hint */}
        {dragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-violet-950/40 backdrop-blur-sm">
            <p className="text-sm font-semibold text-violet-300">Drop image or video here</p>
          </div>
        )}

        {/* Webcam LIVE badge */}
        {webcamActive && (
          <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/70 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live
          </div>
        )}

        {/* Webcam error */}
        {webcamError && (
          <div className="absolute inset-x-2 bottom-2 rounded bg-red-900/80 px-2 py-1.5 text-[11px] text-red-300">
            ⚠ {webcamError}
          </div>
        )}

        {/* Simulated badge */}
        {!showWebcam && !showImage && !isVideoBusy && videoState.status === "idle" && (
          <div className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[10px] uppercase tracking-widest text-neutral-400">
            no live feed — simulated
          </div>
        )}

        {/* Video upload overlay */}
        {isVideoBusy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 backdrop-blur-sm">
            {videoState.status === "uploading" ? (
              <>
                <p className="text-sm font-semibold text-violet-300">Uploading video…</p>
                <div className="w-48 overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-2 rounded-full bg-violet-500 transition-all duration-300"
                    style={{ width: `${videoState.pct}%` }}
                  />
                </div>
                <p className="text-xs text-neutral-400">{videoState.pct}%</p>
              </>
            ) : (
              <>
                <svg className="h-6 w-6 animate-spin text-violet-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <p className="text-sm font-semibold text-violet-300">Processing frames…</p>
                <p className="text-xs text-neutral-400">backend is running VLM on each frame</p>
              </>
            )}
          </div>
        )}

        {/* Done badge */}
        {videoState.status === "done" && (
          <div className="absolute bottom-2 left-2 rounded bg-emerald-900/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
            ✓ {videoState.framesIngested} frames ingested
          </div>
        )}

        {/* Error badge */}
        {videoState.status === "error" && (
          <div className="absolute bottom-2 left-2 right-2 rounded bg-red-900/80 px-2 py-1 text-[10px] text-red-300">
            ✗ {videoState.message}
          </div>
        )}
      </div>
    </div>
  );
}
