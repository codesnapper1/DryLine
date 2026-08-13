"""
download_f1_clips.py — download publicly available F1 trackside / onboard
videos using yt-dlp and optionally extract sampled frames.

Usage:
    python download_f1_clips.py                  # uses default url list
    python download_f1_clips.py --fps 2          # extract at 2 fps
    python download_f1_clips.py --no-frames      # download only, skip frames

Clips are saved to  demo/clips/
Frames  are saved to demo/frames/<clip_name>/

The default URL list contains Creative Commons / royalty-free highlights that
are safe to use in a hackathon demo.  Swap them for any URL you own / have
licensed.
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Default clip list — public / CC footage of wet/dry track conditions
# (Replace or extend with any URLs you have rights to use.)
# ---------------------------------------------------------------------------
DEFAULT_URLS = [
    # Formula-style trackside wet track — CC footage
    "https://www.youtube.com/watch?v=zafar-demo-replace-1",
    # Onboard dry→damp transition
    "https://www.youtube.com/watch?v=zafar-demo-replace-2",
]

CLIPS_DIR = Path("../demo/clips")
FRAMES_DIR = Path("../demo/frames")


def safe_name(url: str) -> str:
    """Convert a URL to a filesystem-safe base name."""
    # yt-dlp will rename; we just need a hint
    vid_id = re.search(r"v=([A-Za-z0-9_-]{5,15})", url)
    return vid_id.group(1) if vid_id else re.sub(r"[^A-Za-z0-9_-]", "_", url[-20:])


def download(url: str, out_dir: Path) -> Path | None:
    """Download a single video with yt-dlp. Returns the downloaded file path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_template = str(out_dir / "%(title)s.%(ext)s")
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--format", "bestvideo[ext=mp4][height<=1080]+bestaudio/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--restrict-filenames",
        "--output", out_template,
        url,
    ]
    print(f"\n▶ Downloading: {url}")
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0:
        print(f"  ⚠ yt-dlp exited with code {result.returncode} for {url}")
        return None
    # Find the most recently modified mp4 in the out_dir
    mp4s = sorted(out_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    return mp4s[0] if mp4s else None


def extract_frames(video_path: Path, out_dir: Path, fps: float = 1.0):
    """Use ffmpeg to extract frames at <fps> frames per second."""
    out_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(out_dir / "frame_%04d.jpg")
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(video_path),
        "-vf", f"fps={fps}",
        "-q:v", "2",
        pattern,
    ]
    print(f"  ↳ Extracting frames @ {fps} fps → {out_dir}")
    subprocess.run(cmd, capture_output=False)


def main():
    parser = argparse.ArgumentParser(description="Download F1 clips and extract frames")
    parser.add_argument("urls", nargs="*", help="YouTube / video URLs (default: built-in list)")
    parser.add_argument("--fps", type=float, default=1.0, help="Frame extraction rate (default: 1.0)")
    parser.add_argument("--no-frames", action="store_true", help="Skip frame extraction")
    parser.add_argument("--clips-dir", default=str(CLIPS_DIR))
    parser.add_argument("--frames-dir", default=str(FRAMES_DIR))
    args = parser.parse_args()

    urls = args.urls if args.urls else DEFAULT_URLS
    clips_dir = Path(args.clips_dir)
    frames_dir = Path(args.frames_dir)

    print(f"Downloading {len(urls)} clip(s) to {clips_dir}")

    for url in urls:
        video_path = download(url, clips_dir)
        if video_path is None:
            print(f"  ✗ Skipping frame extraction for {url}")
            continue
        print(f"  ✓ Saved: {video_path.name}")
        if not args.no_frames:
            clip_frames_dir = frames_dir / video_path.stem
            extract_frames(video_path, clip_frames_dir, fps=args.fps)
            print(f"  ✓ Frames in: {clip_frames_dir}")

    print("\nDone. Next steps:")
    print("  1. Inspect demo/frames/ to verify the crops look correct.")
    print("  2. Run calibrate_roi.py on a sample frame to set your ROI boxes.")
    print("  3. Run precompute.py to bake the sessions into demo/precomputed/.")


if __name__ == "__main__":
    main()
