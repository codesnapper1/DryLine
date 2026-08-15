import type { DecisionFrame } from "../types";

const SECTOR = "S2 - T4";

function formatTime(t: number): string {
  const now = new Date();
  now.setSeconds(now.getSeconds() - t);
  const h = now.getUTCHours().toString().padStart(2, "0");
  const m = now.getUTCMinutes().toString().padStart(2, "0");
  const s = now.getUTCSeconds().toString().padStart(2, "0");
  const ms = now.getUTCMilliseconds().toString().padStart(2, "0").slice(0, 2);
  return `${h}:${m}:${s}.${ms}Z`;
}

function getLabelClass(label: string): string {
  return label.toLowerCase().replace("_", "_");
}

export default function InferenceLog({
  frames,
  onViewFrame,
}: {
  frames: DecisionFrame[];
  onViewFrame: (f: DecisionFrame) => void;
}) {
  const reversed = [...frames].reverse().slice(0, 20);

  return (
    <>
      <div className="panel-header">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="var(--text-dim)" strokeWidth="1.2"/>
          <path d="M3 4h6M3 6.5h4M3 9h5" stroke="var(--text-dim)" strokeWidth="1" strokeLinecap="round"/>
        </svg>
        <span className="panel-label">Inference Logs</span>
      </div>
      <div className="log-table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Thumbnail</th>
              <th>Sector</th>
              <th>Prediction</th>
              <th>Confidence</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {reversed.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--text-dim)", padding: "12px" }}>
                  Waiting for inference data…
                </td>
              </tr>
            )}
            {reversed.map((frame, i) => (
              <tr key={`${frame.t}-${i}`}>
                <td>{formatTime(frames.length > 0 ? (frames[frames.length - 1].t - frame.t) : 0)}</td>
                <td>
                  {frame.image_url ? (
                    <img src={frame.image_url} alt="thumb" className="log-thumb" />
                  ) : (
                    <div className="log-thumb-placeholder">—</div>
                  )}
                </td>
                <td>{SECTOR}</td>
                <td>
                  <span className={`label-chip ${getLabelClass(frame.displayed_label)}`}>
                    {frame.displayed_label}
                  </span>
                </td>
                <td>
                  <span className="log-confidence">
                    {frame.model_confidence.toFixed(2)}
                  </span>
                </td>
                <td>
                  <button
                    className="log-action-btn"
                    onClick={() => onViewFrame(frame)}
                    title="View frame detail"
                  >
                    👁
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
