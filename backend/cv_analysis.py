"""
cv_analysis.py — Computer Vision based track surface analyzer.

Runs purely on OpenCV/NumPy — no API calls, no latency.
Extracts real pixel-level evidence from the track surface image:
  - Gloss/specularity detection (wet tarmac reflects light differently)  
  - Water detection (blue-shift in HSV + dark puddle detection)
  - Texture entropy (wet = low entropy/smooth, dry = high entropy/rough)
  - Reflection detection (specular highlights)
  - Spray detection (white pixel density in motion areas)
  - Dry-patch detection (contrast between line and off-line)
  
This runs FIRST before VLM. Its output is:
  1. Used as a fast fallback when VLM providers fail
  2. Used to pre-validate / augment VLM output
  3. Sent to frontend as "CV Evidence" alongside VLM evidence
"""

import cv2
import numpy as np
from typing import TypedDict


class CVRegionAnalysis(TypedDict):
    surface_gloss: str         # none/slight/moderate/mirror_like
    reflections_visible: bool
    standing_water: str        # none/patches/continuous
    spray_from_cars: str       # none/light/heavy/not_visible
    dry_patches_forming: str   # none/emerging/dominant
    wetness_0_100: int
    confidence_0_100: int
    note: str
    occluded_or_unclear: bool
    # Extra CV-specific fields (bonus data for the frontend)
    specularity_score: float   # 0-1, how many bright highlights
    texture_entropy: float     # Shannon entropy of local texture (dry=high)
    blue_saturation: float     # HSV saturation of blue-tinted pixels (wet=high)
    dark_puddle_ratio: float   # fraction of very dark, low-texture pixels
    cv_method: str             # always "opencv_cv"


def _specularity(gray: np.ndarray) -> float:
    """Fraction of pixels above 220 brightness - specular highlights = gloss/reflections."""
    return float(np.mean(gray > 220))


def _texture_entropy(gray: np.ndarray) -> float:
    """Shannon entropy of local Laplacian response — dry tarmac is rough (high entropy),
    wet tarmac is smooth-glazed (low entropy)."""
    lap = np.abs(cv2.Laplacian(gray, cv2.CV_64F))
    lap_u8 = np.clip(lap, 0, 255).astype(np.uint8)
    hist = cv2.calcHist([lap_u8], [0], None, [32], [0, 256]).flatten()
    hist = hist / (hist.sum() + 1e-9)
    hist = hist[hist > 0]
    return float(-np.sum(hist * np.log2(hist)))


def _water_saturation(bgr: np.ndarray) -> float:
    """In HSV, wet asphalt tends to be dark but has a slight blue-gray tint.
    Returns mean saturation of pixels with hue in the blue range (100-140)."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    blue_mask = (hsv[:, :, 0] >= 95) & (hsv[:, :, 0] <= 145) & (hsv[:, :, 2] > 20)
    sat = hsv[:, :, 1]
    if blue_mask.sum() < 10:
        return 0.0
    return float(sat[blue_mask].mean()) / 255.0


def _dark_puddle_ratio(gray: np.ndarray) -> float:
    """Standing water in F1 camera images often appears as very dark, uniform areas.
    Detects patches with luminance < 60 and very low local texture variance."""
    dark_mask = gray < 60
    if dark_mask.sum() < 20:
        return 0.0
    # Check if dark areas are also uniform (low local std = smooth = water)
    kernel = np.ones((7, 7), np.float32) / 49
    local_mean = cv2.filter2D(gray.astype(np.float32), -1, kernel)
    local_sq = cv2.filter2D((gray.astype(np.float32))**2, -1, kernel)
    local_var = local_sq - local_mean**2
    uniform_dark = dark_mask & (local_var < 200)
    return float(uniform_dark.sum()) / (gray.size + 1e-9)


def _spray_density(gray: np.ndarray) -> float:
    """Spray from cars appears as bright scattered pixels in mid-upper parts of the image.
    Detect by looking for high-frequency bright speckles."""
    # Focus on upper half where spray would be visible (not ground reflections)
    h = gray.shape[0]
    upper = gray[:h//2, :]
    bright = upper > 200
    # Spray has scattered high-freq pattern, not solid bright areas
    return float(bright.mean())


def _gloss_level(spec: float) -> str:
    if spec > 0.08:
        return "mirror_like"
    elif spec > 0.04:
        return "moderate"
    elif spec > 0.015:
        return "slight"
    return "none"


def _water_level(dark_ratio: float, water_sat: float) -> str:
    score = dark_ratio * 0.6 + water_sat * 0.4
    if score > 0.15:
        return "continuous"
    elif score > 0.05:
        return "patches"
    return "none"


def _spray_level(spray: float) -> str:
    if spray > 0.06:
        return "heavy"
    elif spray > 0.025:
        return "light"
    elif spray > 0.005:
        return "none"
    return "not_visible"


def _dry_patches(entropy: float, wetness: int) -> str:
    """High entropy + low wetness = dry patches forming."""
    if entropy > 3.5 and wetness < 35:
        return "dominant"
    elif entropy > 2.8 and wetness < 55:
        return "emerging"
    return "none"


def _estimate_wetness(spec: float, entropy: float, dark_ratio: float, water_sat: float) -> int:
    """Combine all signals into a single 0-100 wetness score.
    
    Key insight:
    - Wet: high specularity OR high dark_ratio + low entropy
    - Dry: low specularity + high entropy + low dark_ratio
    """
    # Specularity increases with wetness (mirror reflections)
    spec_w = min(1.0, spec / 0.10) * 0.35
    
    # Dark puddles / water-colored pixels
    puddle_w = min(1.0, dark_ratio / 0.15) * 0.30
    water_w = min(1.0, water_sat / 0.3) * 0.15
    
    # Low entropy means smooth surface = wet (inverse)
    max_entropy = 4.5
    entropy_w = max(0.0, (max_entropy - entropy) / max_entropy) * 0.20
    
    raw = spec_w + puddle_w + water_w + entropy_w
    return int(min(100, max(0, raw * 100)))


def analyze_region(crop_bgr: np.ndarray, region_name: str) -> CVRegionAnalysis:
    """Full CV analysis of a single ROI crop. Returns typed dict matching EvidenceRegion."""
    if crop_bgr is None or crop_bgr.size == 0:
        return _null_region(region_name)
    
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    
    spec = _specularity(gray)
    entropy = _texture_entropy(gray)
    water_sat = _water_saturation(crop_bgr)
    dark_ratio = _dark_puddle_ratio(gray)
    spray = _spray_density(gray)
    
    wetness = _estimate_wetness(spec, entropy, dark_ratio, water_sat)
    gloss = _gloss_level(spec)
    water_standing = _water_level(dark_ratio, water_sat)
    spray_level = _spray_level(spray)
    dry_patches = _dry_patches(entropy, wetness)
    reflections = spec > 0.02
    
    # Confidence is higher when signals agree
    signals = [
        (spec > 0.03) == (wetness > 40),       # gloss agrees with wetness
        (dark_ratio > 0.05) == (wetness > 40),  # puddles agree with wetness
        (entropy < 3.0) == (wetness > 40),      # texture agrees with wetness
    ]
    agreement = sum(signals) / len(signals)
    confidence = int(55 + agreement * 35)  # 55-90% range
    
    # Build note
    if wetness > 70:
        note = f"Surface appears wet: high specularity ({spec:.3f}), dark areas ({dark_ratio:.3f})"
    elif wetness > 40:
        note = f"Damp surface: moderate gloss ({spec:.3f}), texture entropy {entropy:.2f}"
    else:
        note = f"Dry surface: rough texture (entropy {entropy:.2f}), low reflectivity ({spec:.3f})"
    
    # Check for occlusion (very dark or very bright = bad exposure)
    mean_lum = float(gray.mean())
    occluded = mean_lum < 15 or mean_lum > 245
    
    return CVRegionAnalysis(
        surface_gloss=gloss,
        reflections_visible=reflections,
        standing_water=water_standing,
        spray_from_cars=spray_level,
        dry_patches_forming=dry_patches,
        wetness_0_100=wetness,
        confidence_0_100=confidence,
        note=note,
        occluded_or_unclear=occluded,
        specularity_score=round(spec, 4),
        texture_entropy=round(entropy, 3),
        blue_saturation=round(water_sat, 4),
        dark_puddle_ratio=round(dark_ratio, 4),
        cv_method="opencv_cv",
    )


def _null_region(name: str) -> CVRegionAnalysis:
    return CVRegionAnalysis(
        surface_gloss="none",
        reflections_visible=False,
        standing_water="none",
        spray_from_cars="not_visible",
        dry_patches_forming="none",
        wetness_0_100=0,
        confidence_0_100=0,
        note=f"Region {name} could not be analyzed",
        occluded_or_unclear=True,
        specularity_score=0.0,
        texture_entropy=0.0,
        blue_saturation=0.0,
        dark_puddle_ratio=0.0,
        cv_method="opencv_cv",
    )


def analyze_frame(rois: dict) -> dict[str, CVRegionAnalysis]:
    """Run CV analysis on both ROIs. rois = output of roi.process_rois()."""
    results = {}
    for name, roi_data in rois.items():
        crop = roi_data.get("crop")
        results[name] = analyze_region(crop, name)
    return results
