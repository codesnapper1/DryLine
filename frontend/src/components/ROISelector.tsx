/**
 * ROISelector — interactive canvas-based ROI calibration modal.
 *
 * The user uploads any frame from their real footage, then drags two boxes:
 *   Green  = Racing LINE  (on-track)
 *   Amber  = OFF-LINE area
 *
 * Clicking "Apply" calls POST /session/{id}/roi with the fractional boxes.
 * The parent receives the updated boxes via onApply().
 */

import { useEffect, useRef, useState } from "react";
import type { RoiBox } from "../types";
import { calibrateRoi } from "../api";

interface Props {
  sessionId: string | null;
  onApply: (boxes: { line: RoiBox; off_line: RoiBox }, file?: File) => void;
  onClose: () => void;
}

type BoxKey = "line" | "off_line";
const BOX_COLORS: Record<BoxKey, string> = {
  line: "#00ff78",
  off_line: "#ffb347",
};
const BOX_LABELS: Record<BoxKey, string> = {
  line: "1 – Racing LINE",
  off_line: "2 – OFF-LINE",
};

interface Rect { x: number; y: number; w: number; h: number }

export default function ROISelector({ sessionId, onApply, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [activeKey, setActiveKey] = useState<BoxKey>("line");
  const [boxes, setBoxes] = useState<Record<BoxKey, Rect | null>>({ line: null, off_line: null });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [tempRect, setTempRect] = useState<Rect | null>(null);
  const [status, setStatus] = useState<string>("");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [activeFile, setActiveFile] = useState<File | null>(null);

  const toFractional = (rect: Rect): RoiBox => {
    const canvas = canvasRef.current!;
    return [rect.x / canvas.width, rect.y / canvas.height, rect.w / canvas.width, rect.h / canvas.height];
  };

  // ── Draw loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageLoaded) return;
    const ctx = canvas.getContext("2d")!;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (imgRef.current) ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);

    // Draw committed boxes
    for (const [key, rect] of Object.entries(boxes) as [BoxKey, Rect | null][]) {
      if (!rect) continue;
      ctx.strokeStyle = BOX_COLORS[key];
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = BOX_COLORS[key] + "33";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = BOX_COLORS[key];
      ctx.font = "bold 13px monospace";
      ctx.fillText(BOX_LABELS[key], rect.x + 6, rect.y + 18);
    }

    // Draw live drag rect
    if (tempRect) {
      ctx.strokeStyle = BOX_COLORS[activeKey];
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tempRect.x, tempRect.y, tempRect.w, tempRect.h);
      ctx.setLineDash([]);
    }
  }, [boxes, tempRect, imageLoaded, activeKey]);

  // ── Mouse handlers ───────────────────────────────────────────────────────
  const canvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
    };
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = canvasPos(e);
    setDragging(true);
    setDragStart(pos);
    setTempRect(null);
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging || !dragStart) return;
    const pos = canvasPos(e);
    setTempRect({
      x: Math.min(dragStart.x, pos.x),
      y: Math.min(dragStart.y, pos.y),
      w: Math.abs(pos.x - dragStart.x),
      h: Math.abs(pos.y - dragStart.y),
    });
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging || !dragStart) return;
    const pos = canvasPos(e);
    const w = Math.abs(pos.x - dragStart.x);
    const h = Math.abs(pos.y - dragStart.y);
    if (w > 8 && h > 8) {
      setBoxes(prev => ({
        ...prev,
        [activeKey]: {
          x: Math.min(dragStart.x, pos.x),
          y: Math.min(dragStart.y, pos.y),
          w,
          h,
        },
      }));
    }
    setDragging(false);
    setDragStart(null);
    setTempRect(null);
  };

  // ── Image upload ─────────────────────────────────────────────────────────
  const handleFile = (file: File) => {
    setActiveFile(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current!;
      // Fit to 800×450 max while preserving aspect ratio
      const scale = Math.min(800 / img.width, 450 / img.height, 1);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      setImageLoaded(true);
    };
    img.src = url;
  };

  // ── Apply ────────────────────────────────────────────────────────────────
  const handleApply = async () => {
    if (!sessionId) { setStatus("No active session — create one first."); return; }
    if (!boxes.line || !boxes.off_line) { setStatus("Draw both boxes first."); return; }
    setStatus("Saving…");
    try {
      const res = await calibrateRoi(sessionId, toFractional(boxes.line), toFractional(boxes.off_line));
      onApply(res.roi_boxes as { line: RoiBox; off_line: RoiBox }, activeFile ?? undefined);
      setStatus("✓ ROI saved!");
      setTimeout(onClose, 800);
    } catch (e) {
      setStatus(`Error: ${e}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex w-[860px] max-w-full flex-col gap-4 rounded-xl border border-neutral-700 bg-neutral-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold tracking-tight text-neutral-100">ROI Calibration</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Upload a frame from your real F1 footage and draw the two regions of interest.
            </p>
          </div>
          <button onClick={onClose} className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:text-neutral-100">
            ✕ Close
          </button>
        </div>

        {/* Upload strip */}
        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs text-neutral-300 hover:border-cyan-500 hover:text-cyan-300">
            📂 Load frame / image
            <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>

          {/* Active-box selector */}
          <div className="flex gap-2">
            {(["line", "off_line"] as BoxKey[]).map(key => (
              <button
                key={key}
                onClick={() => setActiveKey(key)}
                className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeKey === key
                    ? "border-current"
                    : "border-neutral-700 text-neutral-500 hover:text-neutral-300"
                }`}
                style={activeKey === key ? { color: BOX_COLORS[key], borderColor: BOX_COLORS[key] } : {}}
              >
                {BOX_LABELS[key]}
              </button>
            ))}
          </div>

          {status && <span className="ml-auto text-xs text-neutral-400">{status}</span>}
        </div>

        {/* Canvas */}
        <div className="flex min-h-[200px] items-center justify-center overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
          {!imageLoaded && (
            <span className="text-xs text-neutral-600">Load a frame to start drawing</span>
          )}
          <canvas
            ref={canvasRef}
            className={imageLoaded ? "block cursor-crosshair" : "hidden"}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          />
        </div>

        {/* Legend + Apply */}
        <div className="flex items-center gap-4">
          {(["line", "off_line"] as BoxKey[]).map(key => (
            <div key={key} className="flex items-center gap-1.5 text-xs">
              <span className="h-3 w-3 rounded-sm" style={{ background: BOX_COLORS[key] + "55", border: `2px solid ${BOX_COLORS[key]}` }} />
              <span className="text-neutral-400">{BOX_LABELS[key]}</span>
              {boxes[key] ? <span className="text-neutral-600">({Math.round(boxes[key]!.w)}×{Math.round(boxes[key]!.h)}px)</span> : <span className="text-neutral-700">not set</span>}
            </div>
          ))}
          <button
            onClick={handleApply}
            disabled={!boxes.line || !boxes.off_line}
            className="ml-auto rounded border border-cyan-700 bg-cyan-900/40 px-5 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-800/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply to Session
          </button>
        </div>
      </div>
    </div>
  );
}
