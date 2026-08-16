import time

from decision import process_observation
from models import TyreState, VisionObservation, WeatherState, TyreCompound
from state import SessionState


def obs(w, t, quality=0.95, conf=0.92, rain=0.0, standing=0.0):
    return VisionObservation(
        wetness=w,
        standing_water=standing,
        rain_intensity=rain,
        vision_confidence=conf,
        frame_quality=quality,
        track_visible=True,
        timestamp=t,
    )


def test_final_change_can_be_conserved_in_marginal_conditions():
    state = SessionState()
    tyre = TyreState(compound=TyreCompound.MEDIUM, health=0.93, changes_remaining=1)
    base = time.time()
    process_observation("x", state, obs(0.18, base), tyre, WeatherState(rain_intensity=0.2, rain_expected_minutes=4), 90)
    result = process_observation("x", state, obs(0.28, base + 10, rain=0.2), tyre, WeatherState(rain_intensity=0.2, rain_expected_minutes=4), 90)
    assert result.strategy.action.value in {"STAY_OUT", "PREPARE", "STRATEGIC_HOLD"}


def test_bad_frame_does_not_update_state():
    state = SessionState()
    tyre = TyreState()
    base = time.time()
    good = process_observation("x", state, obs(0.22, base), tyre, None, 90)
    bad = VisionObservation(wetness=0.95, vision_confidence=0.9, frame_quality=0.1, track_visible=True, timestamp=base + 1)
    rejected = process_observation("x", state, bad, tyre, None, 90)
    assert rejected.accepted_frame is False
    assert rejected.filtered_wetness == good.filtered_wetness
    assert rejected.strategy.action.value == "NO_DECISION"


def test_sudden_rain_moves_to_wetting_or_whiplash():
    state = SessionState()
    tyre = TyreState(compound=TyreCompound.MEDIUM, health=0.82, changes_remaining=2)
    base = time.time()
    process_observation("x", state, obs(0.15, base), tyre, None, 90)
    result = process_observation("x", state, obs(0.55, base + 5, rain=0.8, standing=0.35), tyre, WeatherState(rain_intensity=0.85), 90)
    assert result.condition.value in {"WETTING", "DAMP", "WET"}
    assert result.whiplash is True
