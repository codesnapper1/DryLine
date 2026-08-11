"""Alpha-beta filter (alpha 0.15, beta 0.005, dt from real timestamps) that
turns noisy per-frame W into a smoothed level and a rate, plus the 20s
minimum-dwell hysteresis that keeps the *displayed* label from chattering.
See CLAUDE.md.
"""

from dataclasses import asdict, dataclass

ALPHA = 0.15
BETA = 0.005

# Timestamp gap beyond which we refuse to trust a derivative computed across
# it (CLAUDE.md OOD gate: "widen the confidence band; never interpolate
# across it"). The filter resets rather than pretending it saw continuous data.
MAX_GAP_S = 30.0

DWELL_S = 20.0


@dataclass
class FilterState:
    x: float  # smoothed W
    v: float  # velocity, W per second
    last_t: float | None = None

    @classmethod
    def initial(cls, x0: float) -> "FilterState":
        return cls(x=x0, v=0.0, last_t=None)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "FilterState":
        return cls(**d)


def update(state: FilterState, z: float, t: float) -> tuple[FilterState, float, bool]:
    """One alpha-beta filter step. Returns (new_state, rate_per_min, gap_exceeded).

    gap_exceeded=True means the caller should NOT trust rate/derivative-based
    decisions for this frame (see CLAUDE.md confidence gate) — the filter has
    snapped to the new measurement rather than interpolating.
    """
    if state.last_t is None:
        return FilterState(x=z, v=0.0, last_t=t), 0.0, False

    dt = t - state.last_t
    if dt <= 0:
        # out-of-order / duplicate timestamp: don't let it corrupt the filter
        return state, state.v * 60.0, False

    if dt > MAX_GAP_S:
        return FilterState(x=z, v=0.0, last_t=t), 0.0, True

    x_pred = state.x + state.v * dt
    residual = z - x_pred
    x_new = x_pred + ALPHA * residual
    v_new = state.v + (BETA / dt) * residual
    return FilterState(x=x_new, v=v_new, last_t=t), v_new * 60.0, False


def apply_hysteresis(
    prev_label: str | None,
    prev_change_t: float | None,
    raw_label: str,
    t: float,
) -> tuple[str, float]:
    """20s minimum dwell time on the *displayed* label. The raw (instantaneous)
    label is always computed and stored separately — this only gates what's
    shown, so a demo/UI can always inspect both if it wants to show the gate
    working.
    """
    if prev_label is None:
        return raw_label, t
    if raw_label == prev_label:
        return prev_label, prev_change_t
    if (t - prev_change_t) >= DWELL_S:
        return raw_label, t
    return prev_label, prev_change_t
