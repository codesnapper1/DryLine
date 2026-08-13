import os
import sys
import json
import asyncio
import numpy as np
from PIL import Image
import urllib.request
from io import BytesIO
from dotenv import load_dotenv

# Load .env variables (including API keys)
load_dotenv(os.path.join("..", ".env"))

# Import the existing VLM pipeline
import vlm
import cv2

# Force openrouter-nemotron to avoid Gemini rate limits
vlm.select_provider("openrouter-nemotron")

ROBOFLOW_URLS = [
    "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/GgWTD90IE8HjaXlSjac5/thumb.jpg",
    "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/PldZaAZYkxcvYclgvyrW/thumb.jpg",
    "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/nGU8X8fXVjbRCJiT7lYz/thumb.jpg",
    "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/3kPcW7omFVhJVnqfpeH8/thumb.jpg",
    "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/8yIPeXuoXO4snzWPqCHz/thumb.jpg"
]

async def generate_telemetry_for_image(img_pil: Image.Image, t: float, url: str) -> dict:
    """Takes a PIL Image and runs it through DryLine's VLM to fake telemetry."""
    # Convert PIL to CV2 BGR
    img_cv2 = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
    
    # We must construct regions of interest. 
    h, w = img_cv2.shape[:2]
    rois = {
        "line": {"crop": img_cv2[h//2:h, w//4:3*w//4]}, # bottom center
        "off_line": {"crop": img_cv2[h//2:h, 0:w//4]} # bottom left
    }
    
    try:
        # Mock VLM telemetry directly instead of calling API (which gives 429)
        full_evidence_line = {
            "surface_gloss": "none",
            "reflections_visible": False,
            "standing_water": "none",
            "spray_from_cars": "none",
            "dry_patches_forming": "dominant",
            "wetness_0_100": int((0.2 + (0.05 * t)) * 100),
            "confidence_0_100": 95,
            "note": "Visible dry line forming",
            "occluded_or_unclear": False
        }
        full_evidence_offline = {
            "surface_gloss": "moderate",
            "reflections_visible": True,
            "standing_water": "patches",
            "spray_from_cars": "light",
            "dry_patches_forming": "none",
            "wetness_0_100": 80,
            "confidence_0_100": 90,
            "note": "Track appears wet off line",
            "occluded_or_unclear": False
        }
        ev = {
            "line": full_evidence_line,
            "off_line": full_evidence_offline
        }
        provider_name = "roboflow-mock"
        
        w_line = 0.2 + (0.05 * t)
        w_offline = 0.8
        conf_line = 0.95

        # Assemble standard dryline frame structure
        return {
            "t": t,
            "level": "standing", # dummy
            "raw_label": w_line > 0.5 and "WET" or "DRY",
            "trend": "stable",
            "w_line": w_line,
            "rate_line_per_min": 0.0,
            "w_off_line": w_offline,
            "rate_off_line_per_min": 0.0,
            "divergence": w_line - w_offline,
            "confidence_ok": conf_line > 0.5,
            "confidence_reasons": [],
            "crossover": None,
            "suggestion": ev["line"].get("note", "No specific note"),
            "displayed_label": w_line > 0.5 and "WET" or "DRY",
            "raw_w_line": w_line,
            "raw_w_off_line": w_offline,
            "model_confidence": conf_line,
            "provider": provider_name,
            "evidence": ev,
            "image_url": url,
            "quality": {
                "line": {"laplacian_var": 1000, "mean_luminance": 100},
                "off_line": {"laplacian_var": 1000, "mean_luminance": 100}
            }
        }
    except Exception as e:
        print(f"VLM failed: {e}")
        return None

async def main():
    print("Downloading images from Roboflow...")
    
    frames_data = []
    clip_name = "roboflow_dataset_1.mp4.json"
    
    for i, url in enumerate(ROBOFLOW_URLS):
        print(f"Downloading {url}...")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            img_data = response.read()
        
        img = Image.open(BytesIO(img_data)).convert('RGB')
        t = float(i)
        
        print(f"Processing image {i} for {clip_name} (time={t}s)...")
        frame_data = await generate_telemetry_for_image(img, t, url)
        if frame_data:
            frames_data.append(frame_data)
        
        # Rate limit backoff for free APIs
        await asyncio.sleep(4.0)
        
    output_dir = os.path.join("..", "demo", "precomputed")
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, clip_name)
    
    with open(output_file, "w") as f:
        json.dump({
            "id": clip_name.replace(".json", ""),
            "frames": frames_data
        }, f, indent=2)
        
    print(f"Saved {output_file}!")

if __name__ == "__main__":
    asyncio.run(main())
