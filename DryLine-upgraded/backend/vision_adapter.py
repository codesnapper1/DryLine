from __future__ import annotations

import time
import cv2
import numpy as np
from models import VisionObservation


def heuristic_observation(image: np.ndarray, frame_quality: float) -> VisionObservation:
    """Offline-safe visual fallback.

    The existing DryLine VLM should remain the preferred visual estimator. This
    function only keeps the demo functional without API keys. It derives weak,
    explicitly low-confidence wetness evidence from gloss/brightness/saturation.
    """
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    low_sat = float((s < 55).mean())
    bright = float((v > 165).mean())
    very_bright = float((v > 220).mean())
    dark = float((v < 55).mean())

    # Road reflections often add low-saturation bright regions; this is only a
    # weak fallback signal and intentionally capped below full confidence.
    gloss_proxy = min(1.0, low_sat * 0.65 + bright * 0.55 + very_bright * 0.35)
    wetness = max(0.02, min(0.92, 0.10 + 0.74 * gloss_proxy - 0.15 * dark))

    notes = [
        "offline CV fallback used",
        f"reflection/gloss proxy={gloss_proxy:.2f}",
        "replace with existing structured VLM evidence in production",
    ]

    return VisionObservation(
        wetness=wetness,
        standing_water=max(0.0, min(0.6, (very_bright - 0.05) * 1.5)),
        spray=0.0,
        rain_intensity=0.0,
        vision_confidence=min(0.62, 0.25 + frame_quality * 0.35),
        frame_quality=frame_quality,
        track_visible=True,
        timestamp=time.time(),
        notes=notes,
    )
