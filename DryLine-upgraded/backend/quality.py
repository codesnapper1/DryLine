from __future__ import annotations

import cv2
import numpy as np
from models import QualityMetrics


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def assess_image_quality(image: np.ndarray, previous_gray: np.ndarray | None = None) -> tuple[QualityMetrics, np.ndarray]:
    """Fast gate for corrupted / blurry / badly exposed / frozen frames.

    This deliberately does not try to semantically classify the track. If your
    existing VLM can detect `track_visible`, combine its result with this gate.
    """
    if image is None or image.size == 0:
        metrics = QualityMetrics(
            quality=0.0, blur_score=0.0, exposure_score=0.0,
            frozen_score=0.0, accepted=False, reasons=["empty/corrupt image"]
        )
        return metrics, np.empty((0, 0), dtype=np.uint8)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Blur: Laplacian variance. 120+ is normally sharp enough for track texture.
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    blur_score = _clamp(lap_var / 120.0)

    mean = float(gray.mean())
    # Best around mid exposure, degrade toward clipped dark/bright frames.
    exposure_score = _clamp(1.0 - abs(mean - 128.0) / 118.0)

    frozen_score = 1.0
    if previous_gray is not None and previous_gray.shape == gray.shape:
        diff = float(cv2.absdiff(previous_gray, gray).mean())
        # Completely/near-identical consecutive frames are suspicious.
        frozen_score = _clamp(diff / 2.5)

    quality = 0.50 * blur_score + 0.35 * exposure_score + 0.15 * frozen_score
    reasons: list[str] = []
    if blur_score < 0.35:
        reasons.append("excessive blur")
    if exposure_score < 0.35:
        reasons.append("bad exposure")
    if previous_gray is not None and frozen_score < 0.08:
        reasons.append("possible frozen/duplicate feed")

    accepted = quality >= 0.45 and blur_score >= 0.20 and exposure_score >= 0.20
    if not accepted and not reasons:
        reasons.append("low overall frame quality")

    return QualityMetrics(
        quality=round(quality, 4),
        blur_score=round(blur_score, 4),
        exposure_score=round(exposure_score, 4),
        frozen_score=round(frozen_score, 4),
        accepted=accepted,
        reasons=reasons,
    ), gray
