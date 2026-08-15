#!/usr/bin/env python3
"""Ingest a directory of Roboflow dataset images into a DRYLINE session.

This script sequentially sends all images in a specified folder to the 
local DryLine backend API. The backend processes each frame through the
VLM (which will auto-identify the track regions) and builds up a temporal session.

After processing all images, the script exports the session as a precomputed
JSON file that can be loaded in the dashboard for hackathon judging presentations.

Usage:
  python backend/scripts/ingest_roboflow.py /path/to/roboflow/images --name "roboflow_submission"
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

import httpx

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

API_BASE = "http://localhost:8000"


async def main():
    parser = argparse.ArgumentParser(description="Ingest Roboflow images.")
    parser.add_argument("folder", type=Path, help="Path to folder containing images")
    parser.add_argument("--name", type=str, default="roboflow_submission", help="Session name")
    parser.add_argument("--fps", type=float, default=2.0, help="Simulated sample rate (FPS)")
    args = parser.parse_args()

    if not args.folder.is_dir():
        logger.error(f"Directory not found: {args.folder}")
        sys.exit(1)

    extensions = (".jpg", ".jpeg", ".png", ".webp")
    images = sorted([p for p in args.folder.iterdir() if p.suffix.lower() in extensions])

    if not images:
        logger.error(f"No images found in {args.folder}")
        sys.exit(1)

    logger.info(f"Found {len(images)} images in {args.folder}.")

    async with httpx.AsyncClient(timeout=120.0) as client:
        # 1. Create session
        try:
            resp = await client.post(f"{API_BASE}/session", json={"name": args.name})
            resp.raise_for_status()
        except Exception as e:
            logger.error(f"Failed to connect to backend at {API_BASE}. Is it running? Error: {e}")
            sys.exit(1)
            
        session_id = resp.json()["id"]
        logger.info(f"Created session: {session_id}")

        # 2. Ingest frames
        start_t = time.time()
        for idx, img_path in enumerate(images):
            # Simulate a continuous timeline based on the FPS
            t_val = idx / args.fps
            
            logger.info(f"Processing [{idx+1}/{len(images)}] {img_path.name} (t={t_val:.1f}s)...")
            
            with open(img_path, "rb") as f:
                files = {"image": (img_path.name, f, "image/jpeg")}
                data = {"t": str(t_val)}
                resp = await client.post(f"{API_BASE}/session/{session_id}/frame", data=data, files=files)
                
            if not resp.is_success:
                logger.error(f"Frame {idx} failed: {resp.text}")
                continue
                
            result = resp.json()
            label = result.get("displayed_label", "UNKNOWN")
            conf = result.get("model_confidence", 0.0)
            logger.info(f"  -> Label: {label} (Conf: {conf:.2f})")

        # 3. Export session
        logger.info("Exporting completed session...")
        resp = await client.get(f"{API_BASE}/session/{session_id}/export")
        resp.raise_for_status()
        
        out_dir = Path(__file__).parent.parent.parent / "demo" / "precomputed"
        out_dir.mkdir(parents=True, exist_ok=True)
        
        out_path = out_dir / f"{args.name}.json"
        out_path.write_text(json.dumps(resp.json(), indent=2))
        
        elapsed = time.time() - start_t
        logger.info(f"Success! Exported to {out_path} in {elapsed:.1f}s.")
        logger.info(f"You can now load this in the dashboard from the 'Precomputed' menu.")

if __name__ == "__main__":
    asyncio.run(main())
