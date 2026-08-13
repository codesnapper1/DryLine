import { useState } from "react";
import { createPortal } from "react-dom";
import { getSummary } from "../api";

export default function SessionSummary({ sessionId }: { sessionId: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function openAndFetch() {
    setOpen(true);
    if (!sessionId) return;
    setLoading(true);
    try {
      const { summary } = await getSummary(sessionId);
      setText(summary);
    } catch {
      setText("Could not load the session summary.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={openAndFetch}
        className="rounded-lg border border-white/10 px-4 py-1.5 font-medium text-neutral-200 transition-all duration-300 hover:border-neon-cyan hover:bg-neon-cyan-muted hover:shadow-neon-cyan"
      >
        📋 Notes
      </button>

      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <div
              className="glass-panel mx-4 max-w-lg p-6 shadow-2xl animate-fade-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-neon-cyan">
                  Session Notes — auto-generated
                </h3>
                <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-200">
                  ✕
                </button>
              </div>
              <p className="text-sm leading-relaxed text-neutral-200">
                {loading ? "loading…" : text}
              </p>
              <p className="mt-3 text-[10px] text-neutral-600">
                AI-generated race engineer summary based on recorded label transitions.
              </p>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
