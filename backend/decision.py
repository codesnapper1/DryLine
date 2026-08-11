"""Label renderer + crossover lookup + suggestion strings. This module is the
one place the wetness threshold table lives; nothing else should hardcode a
threshold.

"Drying" is rendered, never predicted: it's a function of (level, rate), not
a class the VLM outputs. A single frame of a drying track and a damp track
can be pixel-identical, so no per-frame call can ever tell them apart —
don't reintroduce a direct classifier here.

evidence_to_w() is the scoring step ahead of everything else in this file: the
VLM (vlm.py) returns structured observations (gloss, standing water, spray,
dry patches, ...) for one region, this turns them into a single W before it
ever reaches classify_level(). Kept in this module so every hardcoded number
in the scoring pipeline lives in one place, next to the level thresholds it feeds.
"""

LEVEL_DRY_MAX = 0.15
LEVEL_DAMP_MAX = 0.40
LEVEL_WET_MAX = 0.70
# above LEVEL_WET_MAX is "standing water" internally; it still displays as
# WET per the brief's exact 4-label contract (Dry/Damp/Wet/Drying).

RATE_STABLE = 0.02  # W per minute; |rate| below this counts as stable

CROSSOVER_WET_TO_INTER = 0.55
CROSSOVER_INTER_TO_SLICK = 0.20

# Evidence scoring — turns one region's VLM observation into a single W.
# Ordinal categorical fields are mapped to evenly-spaced
# scores; "not_visible" for spray is treated as "no evidence of spray", not
# "definitely no spray" — it contributes 0, same as "none", rather than
# fabricating evidence from an admitted blind spot.
_GLOSS_SCORE = {"none": 0.0, "slight": 1 / 3, "moderate": 2 / 3, "mirror_like": 1.0}
_STANDING_SCORE = {"none": 0.0, "patches": 0.5, "continuous": 1.0}
_SPRAY_SCORE = {"none": 0.0, "not_visible": 0.0, "light": 0.5, "heavy": 1.0}
_DRY_PATCH_SCORE = {"none": 0.0, "emerging": 0.5, "dominant": 1.0}

EVIDENCE_WEIGHTS = {"gloss": 0.20, "standing": 0.35, "reflections": 0.15, "spray": 0.20, "dry_patches": -0.30}
EVIDENCE_BLEND = 0.7  # weight on the structured-evidence score vs. the model's own wetness_0_100 guess


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def evidence_to_w(ev: dict) -> tuple[float, float]:
    """One region's VLM evidence dict (the "A" or "B" object from prompts.py's
    JSON schema) -> (W, confidence). W_ev dominates over the model's own
    wetness_0_100 self-report — VLMs are unreliable at absolute numeric
    estimation and reliable at reporting observations.
    """
    w_ev = _clamp01(
        EVIDENCE_WEIGHTS["gloss"] * _GLOSS_SCORE[ev["surface_gloss"]]
        + EVIDENCE_WEIGHTS["standing"] * _STANDING_SCORE[ev["standing_water"]]
        + EVIDENCE_WEIGHTS["reflections"] * (1.0 if ev["reflections_visible"] else 0.0)
        + EVIDENCE_WEIGHTS["spray"] * _SPRAY_SCORE[ev["spray_from_cars"]]
        + EVIDENCE_WEIGHTS["dry_patches"] * _DRY_PATCH_SCORE[ev["dry_patches_forming"]]
    )
    w = _clamp01(EVIDENCE_BLEND * w_ev + (1 - EVIDENCE_BLEND) * (ev["wetness_0_100"] / 100))
    confidence = _clamp01(ev["confidence_0_100"] / 100)
    return w, confidence


SUGGESTIONS = {
    # DRYING must include this exact organizer phrasing verbatim.
    "DRYING": "Track drying: tire change window approaching.",
    "WET": "Track wet: consider full wet tyres.",
    "DAMP": "Track damp: consider intermediates, monitor for further change.",
    "DRY": "Track dry: no change indicated.",
    "LOW_CONFIDENCE": "Low confidence read: image quality or timing gap too large for a reliable call. Consider a manual check.",
}

# Advisory language only, everywhere — "consider", never an imperative.
WETTING_SUGGESTIONS = {
    "WET": "Track wet and trending wetter: consider full wet tyres.",
    "DAMP": "Track damp and trending wetter: monitor closely, wet tyres may be next.",
}


def classify_level(w: float) -> str:
    if w < LEVEL_DRY_MAX:
        return "dry"
    if w < LEVEL_DAMP_MAX:
        return "damp"
    if w < LEVEL_WET_MAX:
        return "wet"
    return "standing"


def trend(rate_per_min: float) -> str:
    if rate_per_min <= -RATE_STABLE:
        return "drying"
    if rate_per_min >= RATE_STABLE:
        return "wetting"
    return "stable"


def render_raw_label(level: str, rate_per_min: float) -> str:
    if level in ("damp", "wet", "standing") and rate_per_min <= -RATE_STABLE:
        return "DRYING"
    display_level = "wet" if level == "standing" else level
    return display_level.upper()


def crossover_estimate(w_line: float, rate_per_min: float, lap_time_s: float) -> dict | None:
    """laps_to_crossover = (W_line - W_crossover) / (-dW/dt), converted to laps
    via lap time. None when not drying or already past the last crossover.
    """
    if rate_per_min >= -1e-6:
        return None
    if w_line > CROSSOVER_WET_TO_INTER:
        target_w, compound = CROSSOVER_WET_TO_INTER, "intermediate"
    elif w_line > CROSSOVER_INTER_TO_SLICK:
        target_w, compound = CROSSOVER_INTER_TO_SLICK, "slick"
    else:
        return None

    minutes = (w_line - target_w) / (-rate_per_min)
    if minutes < 0:
        return None
    laps = (minutes * 60.0) / lap_time_s
    return {
        "target_compound": compound,
        "target_w": target_w,
        "eta_minutes": round(minutes, 1),
        "eta_laps": round(laps, 1),
    }


def suggestion_for(label: str, trend_str: str) -> str:
    if trend_str == "wetting" and label in WETTING_SUGGESTIONS:
        return WETTING_SUGGESTIONS[label]
    return SUGGESTIONS[label]


def build_decision(
    t: float,
    w_line: float,
    rate_line_per_min: float,
    w_off_line: float,
    rate_off_line_per_min: float,
    confidence_ok: bool,
    confidence_reasons: list[str],
    lap_time_s: float,
) -> dict:
    level = classify_level(w_line)
    trend_str = trend(rate_line_per_min)
    raw_label = render_raw_label(level, rate_line_per_min) if confidence_ok else "LOW_CONFIDENCE"
    crossover = crossover_estimate(w_line, rate_line_per_min, lap_time_s) if confidence_ok else None
    suggestion = suggestion_for(raw_label, trend_str)

    return {
        "t": t,
        "level": level,
        "raw_label": raw_label,
        "trend": trend_str,
        "w_line": w_line,
        "rate_line_per_min": rate_line_per_min,
        "w_off_line": w_off_line,
        "rate_off_line_per_min": rate_off_line_per_min,
        "divergence": w_line - w_off_line,
        "confidence_ok": confidence_ok,
        "confidence_reasons": confidence_reasons,
        "crossover": crossover,
        "suggestion": suggestion,
    }


# Weather cross-check — a simple, deliberately conservative heuristic
# comparing our VLM-observed trend
# against weather.py's rain data. This is a second, independent signal on the
# same underlying question ("is the track drying or wetting"), not a
# correction to the VLM reading — "unknown" is a legitimate, common answer.
RAIN_JUST_STOPPED_MIN = 5.0
RAIN_LONG_STOPPED_MIN = 20.0


def weather_agreement(trend_str: str, conditions: dict | None) -> str:
    """"agree" | "disagree" | "unknown". Only calls "disagree" when the
    weather signal is unambiguous and contradicts the observed trend —
    everything in between (just stopped raining, etc.) is "agree" or
    "unknown" rather than a false alarm.
    """
    if conditions is None:
        return "unknown"

    if conditions["is_raining"]:
        return "unknown" if trend_str == "stable" else ("agree" if trend_str == "wetting" else "disagree")

    minutes_since_rain = conditions["minutes_since_rain"]
    if minutes_since_rain is None:
        return "unknown"
    if minutes_since_rain < RAIN_JUST_STOPPED_MIN:
        return "unknown" if trend_str == "wetting" else "agree"
    if minutes_since_rain > RAIN_LONG_STOPPED_MIN:
        return "disagree" if trend_str == "wetting" else "agree"
    return "unknown"
