"""yt-dlp + ffmpeg helper: pulls trackside/onboard clips down to
demo/clips/ and extracts frames at a given sample rate, for curating the
10 validated demo clips and the 4 anchor reference crops (dry/damp/wet/
standing water) in demo/anchors/.

Be mindful of usage rights on any source footage before it goes in demo/clips/.

Usage:
    python extract_frames.py <video_path> <output_dir> [fps]
    python extract_frames.py <video_path> <output_dir> [fps] --roi

The --roi flag additionally runs the backend ROI crop + quality check on
every extracted frame and saves cropped versions into:
    <output_dir>/line/
    <output_dir>/off_line/

This lets you inspect the exact image patches the VLM will see.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

# Allow running from the scripts/ folder without modifying PYTHONPATH
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))


def download_clip(url, output_path):
    print(f"Downloading {url} to {output_path}...")
    subprocess.run([
        "yt-dlp",
        "--no-playlist",
        "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--restrict-filenames",
        "-o", output_path,
        url,
    ])


def extract_frames(video_path, output_dir, fps=1):
    print(f"Extracting frames from {video_path} to {output_dir} at {fps} fps...")
    os.makedirs(output_dir, exist_ok=True)
    subprocess.run([
        "ffmpeg",
        "-y",
        "-i", video_path,
        "-vf", f"fps={fps}",
        "-q:v", "2",
        os.path.join(output_dir, "frame_%04d.jpg"),
    ])


def extract_roi_crops(frames_dir: str, roi_line: tuple, roi_off_line: tuple):
    """For each extracted frame, run the backend ROI crop and save both patches."""
    try:
        import cv2
        import numpy as np
        import roi as roi_mod
    except ImportError as e:
        print(f"  ⚠  ROI crop skipped — could not import backend modules: {e}")
        return

    line_dir = os.path.join(frames_dir, "line")
    off_dir  = os.path.join(frames_dir, "off_line")
    os.makedirs(line_dir, exist_ok=True)
    os.makedirs(off_dir, exist_ok=True)

    jpgs = sorted(Path(frames_dir).glob("frame_*.jpg"))
    if not jpgs:
        print("  ⚠  No frames found to crop.")
        return

    boxes = {"line": roi_line, "off_line": roi_off_line}
    passed = 0

    for p in jpgs:
        img = cv2.imread(str(p))
        if img is None:
            continue
        try:
            rois = roi_mod.process_rois(img, boxes)
        except Exception as ex:
            print(f"  ⚠  ROI error on {p.name}: {ex}")
            continue

        reasons = []
        for name, r in rois.items():
            reasons += roi_mod.quality_reasons(name, r["stats"])

        label = "PASS" if not reasons else f"FAIL({','.join(reasons)})"

        cv2.imwrite(os.path.join(line_dir,    p.name), rois["line"]["crop"])
        cv2.imwrite(os.path.join(off_dir,     p.name), rois["off_line"]["crop"])
        if not reasons:
            passed += 1

    print(f"  ✓ ROI crops done. {passed}/{len(jpgs)} frames passed the confidence gate.")
    print(f"    Crops saved to: {line_dir}")
    print(f"                    {off_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract frames (and optional ROI crops) from a video")
    parser.add_argument("video", help="Path to the video file")
    parser.add_argument("output_dir", help="Directory to save extracted frames")
    parser.add_argument("fps", nargs="?", type=float, default=1.0, help="Frames per second to extract (default: 1)")
    parser.add_argument("--roi", action="store_true", help="Also extract and save ROI crops for each frame")
    parser.add_argument("--roi-line", type=float, nargs=4,
                        metavar=("X", "Y", "W", "H"),
                        default=[0.35, 0.55, 0.30, 0.35],
                        help="Fractional (x y w h) for the racing-line ROI")
    parser.add_argument("--roi-off-line", type=float, nargs=4,
                        metavar=("X", "Y", "W", "H"),
                        default=[0.05, 0.55, 0.25, 0.35],
                        help="Fractional (x y w h) for the off-line ROI")
    args = parser.parse_args()

    extract_frames(args.video, args.output_dir, fps=args.fps)

    if args.roi:
        extract_roi_crops(
            args.output_dir,
            roi_line=tuple(args.roi_line),
            roi_off_line=tuple(args.roi_off_line),
        )

    print("\nDone.")
    print("Example usage:")
    print(f"  python download_f1_clips.py https://youtu.be/... ../demo/clips/real_clip.mp4")
    print(f"  python extract_frames.py ../demo/clips/real_clip.mp4 ../demo/frames/real_clip 1 --roi")
