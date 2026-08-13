"""
calibrate_roi.py — Interactive ROI calibration tool for DRYLINE.

Opens a sample frame from a video or image file and lets you draw two
bounding boxes with the mouse:
  • Box 1 (press 1): Racing LINE  (on-track)
  • Box 2 (press 2): OFF-LINE area

The fractional coordinates (x, y, w, h relative to image size) are printed
and optionally saved to backend/config/roi_boxes.json.

Usage:
    python calibrate_roi.py path/to/frame.jpg
    python calibrate_roi.py path/to/clip.mp4 --frame 30

Controls inside the window:
    Left-click + drag  → draw the current box
    1 / 2              → switch active selection (1 = line, 2 = off_line)
    s                  → save and quit
    q                  → quit without saving
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

COLORS = {
    "line": (0, 255, 120),       # green
    "off_line": (0, 180, 255),   # amber
}
LABELS = {
    "line": "1: RACING LINE",
    "off_line": "2: OFF-LINE",
}

roi_boxes: dict[str, tuple | None] = {"line": None, "off_line": None}
active_key = "line"
drawing = False
ix, iy = -1, -1
temp_rect: tuple | None = None


def mouse_cb(event, x, y, flags, param):
    global drawing, ix, iy, temp_rect, roi_boxes

    if event == cv2.EVENT_LBUTTONDOWN:
        drawing = True
        ix, iy = x, y

    elif event == cv2.EVENT_MOUSEMOVE and drawing:
        temp_rect = (min(ix, x), min(iy, y), abs(x - ix), abs(y - iy))

    elif event == cv2.EVENT_LBUTTONUP:
        drawing = False
        if abs(x - ix) > 5 and abs(y - iy) > 5:
            roi_boxes[active_key] = (min(ix, x), min(iy, y), abs(x - ix), abs(y - iy))
        temp_rect = None


def to_fractional(box: tuple, img_w: int, img_h: int) -> tuple[float, float, float, float]:
    x, y, w, h = box
    return (x / img_w, y / img_h, w / img_w, h / img_h)


def draw_overlay(img: np.ndarray) -> np.ndarray:
    vis = img.copy()
    for key, box in roi_boxes.items():
        if box:
            x, y, w, h = box
            cv2.rectangle(vis, (x, y), (x + w, y + h), COLORS[key], 2)
            cv2.putText(vis, LABELS[key], (x + 4, y + 18),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, COLORS[key], 1, cv2.LINE_AA)

    if temp_rect:
        x, y, w, h = temp_rect
        cv2.rectangle(vis, (x, y), (x + w, y + h), COLORS[active_key], 1)

    # Instructions
    instructions = [
        "Draw ROI then press S to save, Q to quit",
        f"Active: {LABELS[active_key]} (press 1 or 2 to switch)",
    ]
    for i, text in enumerate(instructions):
        cv2.putText(vis, text, (10, 22 + i * 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 220, 220), 1, cv2.LINE_AA)
    return vis


def main():
    global active_key

    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Image or video file to calibrate on")
    parser.add_argument("--frame", type=int, default=0, help="Frame index to grab from video")
    parser.add_argument("--out", default="../backend/config/roi_boxes.json")
    args = parser.parse_args()

    source = Path(args.source)
    if not source.exists():
        print(f"Error: {source} not found")
        sys.exit(1)

    # Load the image
    if source.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}:
        img = cv2.imread(str(source))
    else:
        cap = cv2.VideoCapture(str(source))
        cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
        ok, img = cap.read()
        cap.release()
        if not ok:
            print(f"Error: could not read frame {args.frame} from {source}")
            sys.exit(1)

    if img is None:
        print("Error: could not load image")
        sys.exit(1)

    h, w = img.shape[:2]
    win = "DRYLINE — ROI Calibration"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(win, min(1280, w), min(720, h))
    cv2.setMouseCallback(win, mouse_cb)

    print("Window opened. Draw your ROI boxes and press S to save.")

    while True:
        vis = draw_overlay(img)
        cv2.imshow(win, vis)
        key = cv2.waitKey(20) & 0xFF

        if key == ord("1"):
            active_key = "line"
            print("Active selection: RACING LINE")
        elif key == ord("2"):
            active_key = "off_line"
            print("Active selection: OFF-LINE")
        elif key == ord("s"):
            break
        elif key == ord("q"):
            cv2.destroyAllWindows()
            print("Quit without saving.")
            sys.exit(0)

    cv2.destroyAllWindows()

    # Convert pixel boxes to fractional
    result: dict[str, list[float] | None] = {}
    for key, box in roi_boxes.items():
        if box:
            result[key] = list(to_fractional(box, w, h))
            print(f"  {key}: {result[key]}")
        else:
            result[key] = None
            print(f"  {key}: NOT SET (will use default)")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nSaved to {out_path}")
    print("Pass these values as roi_line / roi_off_line when creating a session.")


if __name__ == "__main__":
    main()
