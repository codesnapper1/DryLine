"""System + user prompt for the VLM evidence call, plus anchor-image loading
(the 4 reference crops in demo/anchors/: dry, damp, wet, standing water, sent
with every request to turn absolute judgment into comparison). See CLAUDE.md
section 4 for why this is structured as evidence extraction, not a direct
wetness number.
"""

import logging
from pathlib import Path

ANCHORS_DIR = Path(__file__).resolve().parent.parent / "demo" / "anchors"
ANCHOR_ORDER = ["dry", "damp", "wet", "standing_water"]
ANCHOR_EXTENSIONS = (".jpg", ".jpeg", ".png")

logger = logging.getLogger(__name__)

SYSTEM = """You are a motorsport track-surface analyst. You will see a composite
image containing two cropped regions of racing circuit tarmac, labelled A and B.
Report ONLY what is visually observable. Output strict JSON. No prose, no markdown."""

USER = """The four reference images above show, in order: DRY, DAMP, WET, STANDING WATER.

Analyse region A (racing line) and region B (off-line) in the target image.
Return exactly this JSON:
{
  "A": {
    "surface_gloss":       "none" | "slight" | "moderate" | "mirror_like",
    "reflections_visible": true | false,
    "standing_water":      "none" | "patches" | "continuous",
    "spray_from_cars":     "none" | "light" | "heavy" | "not_visible",
    "dry_patches_forming": "none" | "emerging" | "dominant",
    "wetness_0_100":       <int>,
    "confidence_0_100":    <int>
  },
  "B": { ...same fields... },
  "occluded_or_unclear": true | false,
  "note": "<one short sentence of visual justification>"
}

Judge by reflections and standing water, NOT brightness alone — shadows and low sun
make dry tarmac look dark or glossy. This is the most common error; avoid it."""


def _find_anchor(name: str) -> Path | None:
    for ext in ANCHOR_EXTENSIONS:
        path = ANCHORS_DIR / f"{name}{ext}"
        if path.exists():
            return path
    return None


def load_anchor_bytes() -> list[bytes]:
    """Loads the 4 anchor crops in ANCHOR_ORDER, skipping any that don't exist
    yet. demo/anchors/ is curated in PLAN.md Phase 4 — calling this before
    that phase is done is expected and safe, it just returns fewer (or zero)
    anchors, which the VLM call still works with, just less reliably per
    CLAUDE.md section 4.
    """
    found: list[bytes] = []
    missing: list[str] = []
    for name in ANCHOR_ORDER:
        path = _find_anchor(name)
        if path is not None:
            found.append(path.read_bytes())
        else:
            missing.append(name)
    if missing:
        logger.warning(
            "demo/anchors/ missing %s — VLM calls will run with %d/%d few-shot anchors "
            "(PLAN.md Phase 4 not done yet).",
            missing,
            len(found),
            len(ANCHOR_ORDER),
        )
    return found
