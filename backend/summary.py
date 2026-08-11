"""Deterministic session recap — a race-engineer's-notes style summary built
by walking the already-recorded frame history for label transitions. No LLM
anywhere here — this is template strings over data we already logged, the
same spirit as decision.py's SUGGESTIONS dict.
"""

_LOW_CONF_NOTE_THRESHOLD = 1


def _fmt_t(t: float) -> str:
    minutes = int(t // 60)
    seconds = int(t % 60)
    return f"{minutes}:{seconds:02d}"


def _fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{int(round(seconds))}s"
    return f"{seconds / 60.0:.1f} min"


def build_summary(frames: list[dict]) -> str:
    if not frames:
        return "No frames ingested yet."

    events: list[tuple[float, str]] = []
    last_label = None
    for f in frames:
        label = f["displayed_label"]
        if label != last_label:
            events.append((f["t"], label))
            last_label = label

    lines = [f"Opened {events[0][1]} at t={_fmt_t(events[0][0])}."]
    for (prev_t, prev_label), (t, label) in zip(events, events[1:]):
        lines.append(f"Crossed to {label} at {_fmt_t(t)} (after {_fmt_duration(t - prev_t)} {prev_label}).")

    final_t = frames[-1]["t"]
    trailing = final_t - events[-1][0]
    if trailing > 0:
        lines.append(f"Held {events[-1][1]} for {_fmt_duration(trailing)} through the end of the session.")

    crossovers = [f["crossover"] for f in frames if f.get("crossover")]
    if crossovers:
        best = min(crossovers, key=lambda c: c["eta_laps"])
        lines.append(f"Earliest tire-change window observed: ~{best['eta_laps']} laps to {best['target_compound']}.")

    low_conf = sum(1 for f in frames if not f["confidence_ok"])
    if low_conf >= _LOW_CONF_NOTE_THRESHOLD:
        noun = "frame" if low_conf == 1 else "frames"
        lines.append(f"{low_conf} {noun} flagged LOW CONFIDENCE during the session.")

    return " ".join(lines)
