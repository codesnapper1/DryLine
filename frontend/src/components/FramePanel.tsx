import { useRef } from "react";
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

export default function FramePanel({
  imageUrl,
  roiBoxes,
  onUpload,
}: {
  imageUrl: string | null;
  roiBoxes: { line: RoiBox; off_line: RoiBox } | null;
  onUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">Camera Frame</h2>
        <button
          onClick={() => inputRef.current?.click()}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-medium text-neutral-300 hover:border-cyan-400 hover:text-cyan-300"
        >
          Upload frame
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      <div className="relative flex-1 overflow-hidden rounded-lg border border-neutral-800">
        {imageUrl ? (
          <img src={imageUrl} alt="uploaded trackside frame" className="h-full w-full object-cover" />
        ) : (
          <div className="track-placeholder h-full w-full" />
        )}
        {roiBoxes && (
          <>
            <RoiOverlay box={roiBoxes.line} color={COLOR_LINE} label="ON-LINE" />
            <RoiOverlay box={roiBoxes.off_line} color={COLOR_OFF_LINE} label="OFF-LINE" />
          </>
        )}
        {!imageUrl && (
          <div className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[10px] uppercase tracking-widest text-neutral-400">
            no live feed — simulated
          </div>
        )}
      </div>
    </div>
  );
}
