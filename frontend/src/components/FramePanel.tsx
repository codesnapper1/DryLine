import { useRef, useState } from "react";

export type VideoUploadState =
  | { status: "idle" }
  | { status: "uploading"; pct: number }
  | { status: "processing" }
  | { status: "done"; framesIngested: number }
  | { status: "error"; message: string };

export default function FramePanel({
  imageUrl,
  onUpload,
  onVideoUpload,
  videoState,
  webcamVideoRef,
  webcamActive,
  webcamError,
  onWebcamStart,
  onWebcamStop,
  simTimeStr,
}: {
  imageUrl: string | null;
  onUpload: (file: File) => void;
  onVideoUpload: (file: File) => void;
  videoState: VideoUploadState;
  webcamVideoRef: React.RefObject<HTMLVideoElement>;
  webcamActive: boolean;
  webcamError: string | null;
  onWebcamStart: () => void;
  onWebcamStop: () => void;
  simTimeStr?: string;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const isVideoBusy = videoState.status === "uploading" || videoState.status === "processing";
  const showWebcam = webcamActive;
  const showImage = !webcamActive && !!imageUrl;

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type.startsWith("video/")) onVideoUpload(file);
    else if (file.type.startsWith("image/")) onUpload(file);
  }

  return (
    <div className="cam-panel">
      {/* Camera header */}
      <div className="cam-header">
        <div className="cam-info-left">
          <span className="cam-label">SECTOR 2 APEX CAM</span>
          <span className="cam-timestamp">{simTimeStr ?? "T00:00:00.00Z"}</span>
        </div>
        <div className="cam-controls">
          {!webcamActive ? (
            <button
              onClick={onWebcamStart}
              disabled={isVideoBusy}
              className="cam-btn"
              title="Start live webcam"
            >
              ⬤ Webcam
            </button>
          ) : (
            <button onClick={onWebcamStop} className="cam-btn danger" title="Stop webcam">
              ■ Stop
            </button>
          )}
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={isVideoBusy || webcamActive}
            className="cam-btn"
            title="Upload image"
          >
            📷 Image
          </button>
          <button
            onClick={() => videoInputRef.current?.click()}
            disabled={isVideoBusy || webcamActive}
            className="cam-btn"
            title="Upload video"
          >
            🎬 Video
          </button>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onVideoUpload(f); e.target.value = ""; }}
        />
      </div>

      {/* Camera body */}
      <div
        className="cam-body"
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          outline: dragging ? "2px solid rgba(167,139,250,0.6)" : webcamActive ? "1px solid rgba(0,229,255,0.3)" : "none",
        }}
      >
        {/* Webcam */}
        <video
          ref={webcamVideoRef}
          autoPlay playsInline muted
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", display: showWebcam ? "block" : "none",
          }}
        />

        {/* Uploaded image */}
        {showImage && (
          <img
            src={imageUrl!}
            alt="trackside frame"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}

        {/* Placeholder */}
        {!showWebcam && !showImage && <div className="track-placeholder" style={{ position: "absolute", inset: 0 }} />}

        {/* AI Auto-Tracking badge */}
        {(showWebcam || showImage) && (
          <div style={{
            position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.8)", borderRadius: 4, padding: "4px 10px",
            border: "1px solid var(--cyan)", boxShadow: "0 0 10px rgba(0,229,255,0.2)",
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: "JetBrains Mono, monospace", fontSize: 10,
            fontWeight: 700, letterSpacing: "0.1em", color: "var(--cyan)", textTransform: "uppercase",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            AI AUTO-TRACKING
          </div>
        )}

        {/* Webcam LIVE badge */}
        {webcamActive && (
          <div style={{
            position: "absolute", top: 8, left: 8,
            display: "flex", alignItems: "center", gap: 5,
            background: "rgba(0,0,0,0.75)", padding: "3px 8px", borderRadius: 3,
            fontFamily: "JetBrains Mono, monospace", fontSize: 9, fontWeight: 700,
            letterSpacing: "0.1em", color: "#22c55e", textTransform: "uppercase",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", background: "#22c55e",
              boxShadow: "0 0 6px #22c55e", display: "inline-block",
              animation: "pulse-rec 1.2s ease-in-out infinite",
            }} />
            Live
          </div>
        )}

        {/* No feed badge */}
        {!showWebcam && !showImage && !isVideoBusy && videoState.status === "idle" && (
          <div style={{
            position: "absolute", bottom: 6, right: 8,
            fontFamily: "JetBrains Mono, monospace", fontSize: 9,
            letterSpacing: "0.08em", color: "var(--text-dim)",
            textTransform: "uppercase",
          }}>
            no live feed — simulated
          </div>
        )}

        {/* Drag hint */}
        {dragging && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(167,139,250,0.1)", backdropFilter: "blur(4px)",
          }}>
            <p style={{ color: "#a78bfa", fontSize: 13, fontWeight: 600 }}>Drop image or video here</p>
          </div>
        )}

        {/* Webcam error */}
        {webcamError && (
          <div style={{
            position: "absolute", bottom: 8, left: 8, right: 8,
            background: "rgba(127,29,29,0.9)", borderRadius: 3, padding: "5px 10px",
            fontSize: 11, color: "#fca5a5",
          }}>
            ⚠ {webcamError}
          </div>
        )}

        {/* Video upload overlay */}
        {isVideoBusy && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
            background: "rgba(0,0,0,0.78)", backdropFilter: "blur(4px)",
          }}>
            {videoState.status === "uploading" ? (
              <>
                <p style={{ color: "#a78bfa", fontWeight: 600, fontSize: 13 }}>Uploading video…</p>
                <div style={{ width: 160, height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${videoState.pct}%`, background: "#a78bfa", borderRadius: 2, transition: "width 0.3s" }} />
                </div>
                <p style={{ color: "var(--text-dim)", fontSize: 11 }}>{videoState.pct}%</p>
              </>
            ) : (
              <>
                <svg style={{ width: 24, height: 24, animation: "spin 1s linear infinite", color: "#a78bfa" }} viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2"/>
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                <p style={{ color: "#a78bfa", fontWeight: 600, fontSize: 13 }}>Processing frames…</p>
              </>
            )}
          </div>
        )}

        {/* Done badge */}
        {videoState.status === "done" && (
          <div style={{
            position: "absolute", bottom: 8, left: 8,
            background: "rgba(6,78,59,0.9)", borderRadius: 3, padding: "3px 8px",
            fontFamily: "JetBrains Mono, monospace", fontSize: 9,
            fontWeight: 700, letterSpacing: "0.08em", color: "#6ee7b7", textTransform: "uppercase",
          }}>
            ✓ {videoState.framesIngested} frames ingested
          </div>
        )}

        {/* Error badge */}
        {videoState.status === "error" && (
          <div style={{
            position: "absolute", bottom: 8, left: 8, right: 8,
            background: "rgba(127,29,29,0.9)", borderRadius: 3, padding: "4px 10px",
            fontSize: 10, color: "#fca5a5",
          }}>
            ✗ {videoState.message}
          </div>
        )}
      </div>
    </div>
  );
}
