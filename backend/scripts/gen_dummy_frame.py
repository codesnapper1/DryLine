"""Writes a synthetic textured JPEG for demo/testing the /frame endpoint.

The real confidence gate in roi.py rejects flat/blurry or too-dark/too-bright
images (that's the point of the gate), so a plain solid-color placeholder
would incorrectly trip LOW CONFIDENCE. This generates mid-luminance noise
with a touch of blur instead — real texture and edges, passes the gate, and
looks nothing like an actual track (nobody should mistake it for one).
"""

import sys

import cv2
import numpy as np


def make_frame(path: str, size: tuple[int, int] = (480, 320), seed: int = 0) -> None:
    rng = np.random.default_rng(seed)
    base = rng.integers(90, 170, size=(size[1], size[0], 3), dtype=np.uint8)
    img = cv2.GaussianBlur(base, (3, 3), 0)
    cv2.imwrite(path, img)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "dummy_frame.jpg"
    make_frame(out)
    print(out)
