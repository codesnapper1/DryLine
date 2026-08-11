import { useState } from "react";
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
        className="rounded border border-neutral-700 px-3 py-1.5 font-medium text-neutral-200 hover:border-cyan-400 hover:text-cyan-300"
      >
        📋 Session Notes
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setOpen(false)}
        >
          <div
            className="mx-4 max-w-lg rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-400">
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
              Deterministic recap of this session's label transitions — no LLM, template strings over recorded data.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
