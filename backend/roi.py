"""ROI crop + Shades-of-Gray colour constancy (p=6) per frame, plus the
image-quality checks that feed the confidence/OOD gate.

This module is real (not stubbed): it operates on actual decoded image bytes.
It has no dependency on vlm.py, so the fake decider in vlm.py can be swapped
for the real hosted-VLM provider chain without touching this file.

build_composite() stitches the two ROI crops into one side-by-side image
(labelled A: RACING LINE / B: OFF-LINE) so a single VLM call scores both
regions instead of two — that halves the per-frame API call budget.
"""

import cv2
import numpy as np

# Fractional (x, y, w, h) boxes, used when a session doesn't supply calibration
# boxes of its own. Real deployments use hand-drawn "circuit calibration"
# boxes from the frontend — these are just a reasonable trackside-camera
# default (lower-center = racing line, lower-left = off line).
DEFAULT_ROI_LINE = (0.35, 0.55, 0.30, 0.35)
DEFAULT_ROI_OFF_LINE = (0.05, 0.55, 0.25, 0.35)

MODEL_INPUT_SIZE = (224, 224)

# Confidence/OOD gate thresholds. Placeholder heuristics — these get
# calibrated against real trackside footage once some exists; until then
# they exist to prove the gate mechanism works, not to be precisely tuned.
BLUR_VAR_MIN = 50.0
LUMINANCE_MIN = 20.0
LUMINANCE_MAX = 235.0


def shades_of_gray(img_bgr: np.ndarray, p: int = 6) -> np.ndarray:
    img = img_bgr.astype(np.float64) + 1e-6
    illum = np.power(np.mean(np.power(img, p), axis=(0, 1)), 1.0 / p)
    illum = illum / (np.linalg.norm(illum) + 1e-9) * np.sqrt(3)
    corrected = img / illum
    return np.clip(corrected, 0, 255).astype(np.uint8)


def crop_fractional(img_bgr: np.ndarray, box: tuple[float, float, float, float]) -> np.ndarray:
    h, w = img_bgr.shape[:2]
    x, y, bw, bh = box
    x0, y0 = max(0, int(x * w)), max(0, int(y * h))
    x1, y1 = min(w, int((x + bw) * w)), min(h, int((y + bh) * h))
    if x1 <= x0 or y1 <= y0:
        raise ValueError(f"degenerate ROI box {box} for image size {(w, h)}")
    return img_bgr[y0:y1, x0:x1]


def quality_stats(crop_bgr: np.ndarray) -> dict[str, float]:
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    return {
        "laplacian_var": float(cv2.Laplacian(gray, cv2.CV_64F).var()),
        "mean_luminance": float(gray.mean()),
    }


def quality_reasons(name: str, stats: dict[str, float]) -> list[str]:
    reasons = []
    if stats["laplacian_var"] < BLUR_VAR_MIN:
        reasons.append(f"{name}_blurry")
    if not (LUMINANCE_MIN <= stats["mean_luminance"] <= LUMINANCE_MAX):
        reasons.append(f"{name}_luminance_out_of_range")
    return reasons


def process_rois(img_bgr: np.ndarray, roi_boxes: dict[str, tuple]) -> dict[str, dict]:
    """Crop + colour-correct each named ROI, resize to model input size, and
    compute the quality stats the confidence gate needs. Returns
    {name: {"crop": ndarray[224,224,3], "stats": {...}}}.
    """
    out = {}
    for name, box in roi_boxes.items():
        crop = crop_fractional(img_bgr, box)
        corrected = shades_of_gray(crop, p=6)
        stats = quality_stats(corrected)
        resized = cv2.resize(corrected, MODEL_INPUT_SIZE)
        out[name] = {"crop": resized, "stats": stats}
    return out


def _label_corner(img: np.ndarray, text: str) -> None:
    """Burns a small filled label into the top-left corner in place — the
    prompt (prompts.py) tells the VLM "labelled A and B", this is what makes
    that literally true rather than relying on the model inferring left=A."""
    cv2.rectangle(img, (0, 0), (30, 26), (0, 0, 0), -1)
    cv2.putText(img, text, (7, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)


def build_composite(rois: dict[str, dict]) -> np.ndarray:
    """Stitches the 'line' (A) and 'off_line' (B) crops side by side with a
    thin white separator, one image per VLM call instead of two, halving the
    per-frame API call budget. Expects the {"crop": ndarray, ...} shape
    process_rois() returns.
    """
    left = rois["line"]["crop"].copy()
    right = rois["off_line"]["crop"].copy()
    _label_corner(left, "A")
    _label_corner(right, "B")
    separator = np.full((left.shape[0], 6, 3), 255, dtype=np.uint8)
    return np.hstack([left, separator, right])
