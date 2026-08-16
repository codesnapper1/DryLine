from __future__ import annotations

import math
import time
from typing import Optional

from models import (
    AnalysisResult, StrategyAction, StrategyResult, SystemHealth,
    SystemStatus, TrackCondition, TyreCompound, TyreScore,
    TyreState, VisionObservation, WeatherState,
)
from state import SessionState, Sample


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def classify_condition(wetness: float, rate_per_min: float) -> TrackCondition:
    # Dynamic states take precedence when the rate is meaningful.
    if rate_per_min <= -0.035 and wetness > 0.14:
        return TrackCondition.DRYING
    if rate_per_min >= 0.035 and wetness > 0.10:
        return TrackCondition.WETTING
    if wetness < 0.18:
        return TrackCondition.DRY
    if wetness < 0.48:
        return TrackCondition.DAMP
    return TrackCondition.WET


def _alpha_beta_update(state: SessionState, measured: float, timestamp: float) -> tuple[float, float]:
    if state.filtered_wetness is None or state.last_valid_timestamp is None:
        state.filtered_wetness = measured
        state.filtered_rate_per_sec = 0.0
        state.last_valid_timestamp = timestamp
        return measured, 0.0

    dt = max(0.15, min(10.0, timestamp - state.last_valid_timestamp))
    predicted = clamp(state.filtered_wetness + state.filtered_rate_per_sec * dt)
    residual = measured - predicted

    # Conservative enough to suppress single-frame outliers, responsive enough
    # for real weather whiplash.
    alpha = 0.34
    beta = 0.09
    state.filtered_wetness = clamp(predicted + alpha * residual)
    state.filtered_rate_per_sec = clamp(
        state.filtered_rate_per_sec + (beta / dt) * residual,
        -0.03,
        0.03,
    )
    state.last_valid_timestamp = timestamp
    return state.filtered_wetness, state.filtered_rate_per_sec * 60.0


def tyre_base_compatibility(compound: TyreCompound, wetness: float, standing_water: float) -> float:
    """0..1 suitability curve. Values are demonstrator heuristics, not F1 telemetry."""
    w = clamp(wetness)
    standing = clamp(standing_water)

    if compound in {TyreCompound.SOFT, TyreCompound.MEDIUM, TyreCompound.HARD}:
        # Slicks excellent dry, deteriorate sharply after damp crossover.
        score = 1.0 - 1.35 * max(0.0, w - 0.10) - 0.85 * standing
        if compound == TyreCompound.SOFT:
            score += 0.03 if w < 0.18 else -0.03
        elif compound == TyreCompound.HARD:
            score -= 0.03 if w < 0.18 else 0.01
        return clamp(score)

    if compound == TyreCompound.INTERMEDIATE:
        # Broad peak through damp/light-wet conditions.
        score = 1.0 - abs(w - 0.48) * 1.18 - max(0.0, standing - 0.45) * 0.5
        return clamp(score)

    # Full wet.
    score = 1.0 - abs(w - 0.80) * 1.12 + standing * 0.18
    return clamp(score)


def health_effective(tyre: TyreState) -> float:
    health = tyre.health
    if tyre.temperature_c is not None:
        # Demo operating bands; configurable in a production model.
        if tyre.compound in {TyreCompound.INTERMEDIATE, TyreCompound.WET}:
            ideal = 70.0
        else:
            ideal = 92.0
        temp_penalty = min(0.18, abs(tyre.temperature_c - ideal) / 180.0)
        health -= temp_penalty
    health -= min(0.16, tyre.age_laps * 0.003)
    return clamp(health, 0.05, 1.0)


def all_tyre_scores(
    tyre: TyreState,
    wetness: float,
    standing_water: float,
) -> list[TyreScore]:
    current_health = health_effective(tyre)
    results: list[TyreScore] = []
    for compound in TyreCompound:
        compat = tyre_base_compatibility(compound, wetness, standing_water)
        # Current tyre uses its actual health; a replacement is assumed fresh.
        health = current_health if compound == tyre.compound else 1.0
        adjusted = compat * (0.72 + 0.28 * health)

        strategic = adjusted
        if compound != tyre.compound:
            # Every stop costs track position; final changes/sets have scarcity value.
            strategic -= min(0.20, tyre.pit_loss_seconds / 180.0)
            if tyre.changes_remaining <= 0:
                strategic -= 1.0
            elif tyre.changes_remaining == 1:
                strategic -= 0.12
            elif tyre.changes_remaining == 2:
                strategic -= 0.05
        results.append(TyreScore(
            compound=compound,
            compatibility=round(compat, 3),
            health_adjusted_score=round(clamp(adjusted), 3),
            strategic_score=round(strategic, 3),
        ))
    return results


def _weather_agreement(observation: VisionObservation, weather: Optional[WeatherState]) -> float:
    if not weather or weather.rain_intensity is None:
        return 0.65
    camera_rain = max(observation.rain_intensity, observation.spray, observation.standing_water * 0.7)
    diff = abs(camera_rain - weather.rain_intensity)
    return clamp(1.0 - diff)


def predict_crossover_laps(
    tyre: TyreState,
    filtered_wetness: float,
    rate_per_min: float,
    standing_water: float,
    lap_time_seconds: float,
    target: TyreCompound,
) -> Optional[tuple[float, float]]:
    if abs(rate_per_min) < 0.005:
        return None

    per_lap_delta = rate_per_min * (lap_time_seconds / 60.0)
    for step in range(1, 31):
        laps = step / 3.0
        future_w = clamp(filtered_wetness + per_lap_delta * laps)
        current_c = tyre_base_compatibility(tyre.compound, future_w, standing_water)
        target_c = tyre_base_compatibility(target, future_w, standing_water)
        # Require a useful advantage, not a numerical tie.
        if target_c >= current_c + 0.08:
            uncertainty = max(0.5, 1.7 - abs(rate_per_min) * 4.0)
            return (round(max(0.0, laps - uncertainty), 1), round(laps + uncertainty, 1))
    return None


def build_strategy(
    observation: VisionObservation,
    tyre: TyreState,
    filtered_wetness: float,
    rate_per_min: float,
    lap_time_seconds: float,
    weather: Optional[WeatherState],
    system_data_confidence: float,
) -> StrategyResult:
    scores = all_tyre_scores(tyre, filtered_wetness, observation.standing_water)
    by_compound = {s.compound: s for s in scores}
    current = by_compound[tyre.compound]
    recommended = max(scores, key=lambda x: x.strategic_score)

    agreement = _weather_agreement(observation, weather)
    reasons: list[str] = []

    if system_data_confidence < 0.42:
        return StrategyResult(
            action=StrategyAction.HOLD_DECISION,
            recommended_tyre=tyre.compound,
            current_tyre=tyre.compound,
            current_compatibility=current.compatibility,
            recommended_compatibility=current.compatibility,
            crossover_laps=None,
            strategy_confidence=round(system_data_confidence, 3),
            risk_score=min(100, round(filtered_wetness * 55 + observation.standing_water * 35 + max(0, rate_per_min) * 90)),
            reasons=["insufficient reliable data for a new tyre decision"],
            scores=scores,
        )

    delta = recommended.strategic_score - current.strategic_score
    current_health = health_effective(tyre)

    # Risk deliberately not identical to wetness.
    risk = clamp(
        0.36 * filtered_wetness
        + 0.25 * observation.standing_water
        + 0.12 * observation.spray
        + 0.12 * clamp(max(0.0, rate_per_min) / 0.20)
        + 0.10 * (1.0 - current_health)
        + 0.05 * (1.0 - observation.vision_confidence)
    )
    risk_score = round(risk * 100)

    crossover = None
    if recommended.compound != tyre.compound:
        crossover = predict_crossover_laps(
            tyre, filtered_wetness, rate_per_min,
            observation.standing_water, lap_time_seconds,
            recommended.compound,
        )

    if recommended.compound == tyre.compound or delta < 0.035:
        action = StrategyAction.STAY_OUT
        reasons.append("current tyre remains the best strategic option")
    elif tyre.changes_remaining <= 0:
        action = StrategyAction.STRATEGIC_HOLD
        recommended = current
        reasons.append("no tyre changes/sets remain")
    elif tyre.changes_remaining == 1 and delta < 0.13 and risk_score < 72:
        action = StrategyAction.STRATEGIC_HOLD
        reasons.append("alternative has more grip, but conserving the final tyre change currently has greater value")
    elif delta >= 0.16 or current.compatibility < 0.42 or risk_score >= 76:
        action = StrategyAction.PIT
        reasons.append("current tyre has crossed the safety/performance threshold")
    else:
        action = StrategyAction.PREPARE
        reasons.append("crossover is approaching; prepare the recommended compound")

    if rate_per_min > 0.035:
        reasons.append(f"track is wetting at +{rate_per_min:.1%}/min")
    elif rate_per_min < -0.035:
        reasons.append(f"track is drying at {rate_per_min:.1%}/min")

    if observation.racing_line_wetness is not None and observation.offline_wetness is not None:
        diff = observation.offline_wetness - observation.racing_line_wetness
        if diff > 0.10:
            reasons.append(f"racing line is {diff:.0%} drier than off-line")

    if tyre.health >= 0.8:
        reasons.append(f"current tyre health remains strong at {tyre.health:.0%}")
    elif tyre.health < 0.45:
        reasons.append(f"current tyre health is low at {tyre.health:.0%}")

    if tyre.changes_remaining == 1:
        reasons.append("only one tyre change/set remains")

    if weather and weather.rain_expected_minutes is not None and weather.rain_expected_minutes <= 5 and rate_per_min > 0:
        reasons.append("rain appears short-lived; resource conservation is weighted more heavily")

    confidence = clamp(
        0.45 * observation.vision_confidence
        + 0.25 * system_data_confidence
        + 0.20 * agreement
        + 0.10 * min(1.0, abs(delta) * 5.0)
    )
    if abs(delta) < 0.05:
        confidence *= 0.82

    return StrategyResult(
        action=action,
        recommended_tyre=recommended.compound,
        current_tyre=tyre.compound,
        current_compatibility=current.compatibility,
        recommended_compatibility=recommended.compatibility,
        crossover_laps=crossover,
        strategy_confidence=round(confidence, 3),
        risk_score=risk_score,
        reasons=reasons[:6],
        scores=scores,
    )


def rejected_result(
    session_id: str,
    state: SessionState,
    tyre: TyreState,
    now: float,
    reasons: list[str],
) -> AnalysisResult:
    state.rejected_frames += 1
    age = (now - state.last_valid_timestamp) if state.last_valid_timestamp else 999.0
    if state.filtered_wetness is None:
        condition = TrackCondition.UNKNOWN
        wetness = 0.0
        rate = 0.0
    else:
        condition = TrackCondition(state.last_condition)
        wetness = state.filtered_wetness
        rate = state.filtered_rate_per_sec * 60.0

    status = SystemStatus.DEGRADED if age < 8 else SystemStatus.STALE if age < 20 else SystemStatus.LOST
    data_conf = clamp(0.65 * math.exp(-age / 12.0))
    scores = all_tyre_scores(tyre, wetness, 0.0)
    current = next(x for x in scores if x.compound == tyre.compound)
    no_decision = StrategyResult(
        action=StrategyAction.NO_DECISION,
        recommended_tyre=tyre.compound,
        current_tyre=tyre.compound,
        current_compatibility=current.compatibility,
        recommended_compatibility=current.compatibility,
        strategy_confidence=round(data_conf, 3),
        risk_score=round(wetness * 60),
        reasons=["frame rejected; strategy intentionally unchanged"],
        scores=scores,
    )
    trend = [s.__dict__ for s in state.trend[-60:]]
    return AnalysisResult(
        session_id=session_id,
        condition=condition if age < 20 else TrackCondition.UNKNOWN,
        raw_wetness=wetness,
        filtered_wetness=wetness,
        wetness_rate_per_min=rate,
        whiplash=False,
        vision_confidence=0.0,
        strategy=no_decision,
        system=SystemHealth(
            status=status,
            data_confidence=round(data_conf, 3),
            frame_age_seconds=round(age, 2),
            sensor_agreement=0.0,
            warnings=reasons + (["last reliable reading is stale"] if age >= 8 else []),
        ),
        accepted_frame=False,
        rejection_reasons=reasons,
        trend=trend,
    )


def process_observation(
    session_id: str,
    state: SessionState,
    observation: VisionObservation,
    tyre: TyreState,
    weather: Optional[WeatherState],
    lap_time_seconds: float,
) -> AnalysisResult:
    now = observation.timestamp or time.time()
    rejection: list[str] = []
    if not observation.track_visible:
        rejection.append("no usable track surface detected")
    if observation.frame_quality < 0.45:
        rejection.append("frame quality below acceptance threshold")
    if observation.vision_confidence < 0.20:
        rejection.append("vision confidence too low")
    if rejection:
        return rejected_result(session_id, state, tyre, now, rejection)

    previous_w = state.filtered_wetness
    previous_ts = state.last_valid_timestamp
    filtered, rate_per_min = _alpha_beta_update(state, observation.wetness, now)

    condition = classify_condition(filtered, rate_per_min)

    # Large, fast changes become a whiplash event. Because the temporal filter is
    # already applied, a single wild frame is much less likely to trigger it.
    whiplash = False
    whiplash_message = None
    if previous_w is not None and previous_ts is not None:
        dt = max(0.2, now - previous_ts)
        raw_rate_min = (observation.wetness - previous_w) / dt * 60.0
        if abs(raw_rate_min) >= 0.16 and observation.vision_confidence >= 0.62:
            whiplash = True
            direction = "wetter" if raw_rate_min > 0 else "drier"
            whiplash_message = f"rapid track change detected: {direction}"

    agreement = _weather_agreement(observation, weather)
    freshness = 1.0
    data_conf = clamp(
        0.42 * observation.frame_quality
        + 0.38 * observation.vision_confidence
        + 0.20 * agreement
    ) * freshness

    warnings: list[str] = []
    if agreement < 0.48:
        warnings.append("camera/weather sensors disagree")
    if observation.frame_quality < 0.62:
        warnings.append("frame quality degraded")

    strategy = build_strategy(
        observation, tyre, filtered, rate_per_min,
        lap_time_seconds, weather, data_conf,
    )

    state.last_condition = condition.value
    state.last_observation = observation
    state.trend.append(Sample(
        timestamp=now,
        wetness=round(filtered, 4),
        rate_per_min=round(rate_per_min, 4),
        condition=condition.value,
        confidence=round(data_conf, 4),
    ))
    state.trend = state.trend[-180:]

    return AnalysisResult(
        session_id=session_id,
        condition=condition,
        raw_wetness=round(observation.wetness, 4),
        filtered_wetness=round(filtered, 4),
        wetness_rate_per_min=round(rate_per_min, 4),
        racing_line_wetness=observation.racing_line_wetness,
        offline_wetness=observation.offline_wetness,
        whiplash=whiplash,
        whiplash_message=whiplash_message,
        vision_confidence=observation.vision_confidence,
        strategy=strategy,
        system=SystemHealth(
            status=SystemStatus.HEALTHY if data_conf >= 0.66 and not warnings else SystemStatus.DEGRADED,
            data_confidence=round(data_conf, 3),
            frame_age_seconds=0.0,
            sensor_agreement=round(agreement, 3),
            warnings=warnings,
        ),
        accepted_frame=True,
        trend=[s.__dict__ for s in state.trend[-60:]],
    )
