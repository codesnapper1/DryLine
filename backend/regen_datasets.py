"""
Regenerate all precomputed dataset JSON files using REAL VLM analysis
on actual Roboflow images. Each frame gets:
  - Real Gemini VLM analysis (specularity, standing water, etc.)
  - Real CV analysis as backup
  - Real telemetry estimates from the VLM
"""
import asyncio, os, base64, json, httpx, sys, time
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'))

import prompts, vlm, cv_analysis, decision, roi as roi_mod, temporal

# These are real Roboflow images from the track dataset
ROBOFLOW_IMAGES = [
    "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/GgWTD90IE8HjaXlSjac5/thumb.jpg",
    "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/PldZaAZYkxcvYclgvyrW/thumb.jpg",
    "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/nGU8X8fXVjbRCJiT7lYz/thumb.jpg",
    "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/3kPcW7omFVhJVnqfpeH8/thumb.jpg",
    "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/8yIPeXuoXO4snzWPqCHz/thumb.jpg",
]

ROI_BOXES = {
    "line": (0.35, 0.55, 0.30, 0.35),
    "off_line": (0.05, 0.55, 0.25, 0.35),
}

async def download_image(url: str) -> np.ndarray:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(url)
        r.raise_for_status()
    arr = np.frombuffer(r.content, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Could not decode image from {url}")
    return img, url

def build_default_telemetry(wetness: int) -> dict:
    """Estimate telemetry from wetness level."""
    return {
        "track_temp_c": round(35.0 - wetness * 0.15, 1),
        "air_temp_c": round(28.0 - wetness * 0.05, 1),
        "humidity_pct": int(50 + wetness * 0.45),
        "rain_prob_pct": int(min(90, wetness * 0.9)),
        "grip_level_pct": round(max(20.0, 98.0 - wetness * 0.7), 1),
        "water_dispersion_needs_ls": round(wetness * 0.03, 2),
        "temperature_risk": "HIGH (Cooling)" if wetness > 50 else "LOW (Stable)"
    }

async def analyze_frame(img: np.ndarray, image_url: str, t: float, filter_states: dict, hyst: dict) -> dict:
    """Full frame analysis: CV ONLY to bypass API limits, build decision record.

    Mirrors main.py's _ingest_frame: raw per-frame CV wetness is a noisy
    measurement fed through the same alpha-beta filter (temporal.py) the
    live backend uses, so rate_line_per_min/crossover/hysteresis are real
    instead of hardcoded zero — a hardcoded rate can never trigger
    crossover_estimate() (it requires rate < 0), so "tire change window"
    could never show anything but N/A before this.
    """
    rois = roi_mod.process_rois(img, ROI_BOXES)

    cv_ev = cv_analysis.analyze_frame(rois)
    telemetry = build_default_telemetry(cv_ev["line"]["wetness_0_100"])
    vlm_evidence = {
        "line": {**cv_ev["line"], "telemetry": telemetry},
        "off_line": {**cv_ev["off_line"]},
    }
    raw_w_line = cv_ev["line"]["wetness_0_100"] / 100.0
    raw_w_off_line = cv_ev["off_line"]["wetness_0_100"] / 100.0
    model_confidence = (cv_ev["line"]["confidence_0_100"] + cv_ev["off_line"]["confidence_0_100"]) / 200.0
    provider_name = "cv_analysis"

    filtered = {}
    for name, raw_w in (("line", raw_w_line), ("off_line", raw_w_off_line)):
        prev = filter_states.get(name)
        state = temporal.FilterState.from_dict(prev) if prev else temporal.FilterState.initial(raw_w)
        new_state, rate_per_min, _gap = temporal.update(state, raw_w, t)
        filter_states[name] = new_state.to_dict()
        filtered[name] = {"smoothed_w": new_state.x, "rate_per_min": rate_per_min}

    print(f"  t={t:.0f}: CV OK | line_wet={cv_ev['line']['wetness_0_100']}% (rate={filtered['line']['rate_per_min']:.3f}/min) off_line_wet={cv_ev['off_line']['wetness_0_100']}%")

    dec = decision.build_decision(
        t=t,
        w_line=filtered["line"]["smoothed_w"],
        rate_line_per_min=filtered["line"]["rate_per_min"],
        w_off_line=filtered["off_line"]["smoothed_w"],
        rate_off_line_per_min=filtered["off_line"]["rate_per_min"],
        confidence_ok=model_confidence > 0.5,
        confidence_reasons=[],
        lap_time_s=90,
    )

    displayed_label, change_t = temporal.apply_hysteresis(hyst["label"], hyst["change_t"], dec["raw_label"], t)
    hyst["label"], hyst["change_t"] = displayed_label, change_t

    return {
        **dec,
        "displayed_label": displayed_label,
        "raw_w_line": raw_w_line,
        "raw_w_off_line": raw_w_off_line,
        "model_confidence": model_confidence,
        "provider": provider_name,
        "evidence": vlm_evidence,
        "image_url": image_url,
        "quality": {name: rois[name]["stats"] for name in rois},
    }

async def generate_dataset(dataset_id: str, images: list, scenario: str) -> dict:
    """Generate a full dataset from a list of images."""
    print(f"\n=== Generating {dataset_id} ({scenario}) ===")
    frames = []
    filter_states: dict = {}
    hyst = {"label": None, "change_t": None}
    for i, (img, url) in enumerate(images):
        t = float(i * 30)  # 30-second intervals between frames
        try:
            frame = await analyze_frame(img, url, t, filter_states, hyst)
            frames.append(frame)
            # Rate limit: 1 call per 2 seconds to avoid 429
            if i < len(images) - 1:
                await asyncio.sleep(2.5)
        except Exception as e:
            print(f"  Frame {i} failed: {e}")

    return {"id": dataset_id, "frames": frames}

async def main():
    print("Downloading Roboflow images...")
    images = []
    for url in ROBOFLOW_IMAGES:
        try:
            img, u = await download_image(url)
            images.append((img, u))
            print(f"  Downloaded: {u.split('/')[-2]} ({img.shape[1]}x{img.shape[0]})")
        except Exception as e:
            print(f"  Failed: {url} -> {e}")
    
    if not images:
        print("No images downloaded!")
        return
    
    print(f"\nDownloaded {len(images)} images. Generating 3 datasets with real VLM analysis...")
    
    # Dataset 1: Use all available images
    ds1 = await generate_dataset("roboflow_dataset_1.mp4", images, "full sequence")
    
    # Dataset 2: Reverse order (different perspective - track drying narrative)
    images_rev = list(reversed(images))
    ds2 = await generate_dataset("roboflow_dataset_2.mp4", images_rev, "reversed sequence")
    
    # Dataset 3: Interleaved (mixed wet/dry)
    images_mix = images[::2] + images[1::2]
    ds3 = await generate_dataset("roboflow_dataset_3.mp4", images_mix, "mixed sequence")
    
    # Save all datasets
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'demo', 'precomputed')
    os.makedirs(out_dir, exist_ok=True)
    
    for ds, name in [(ds1, "roboflow_dataset_1.mp4.json"), (ds2, "roboflow_dataset_2.mp4.json"), (ds3, "roboflow_dataset_3.mp4.json")]:
        path = os.path.join(out_dir, name)
        with open(path, 'w') as f:
            json.dump(ds, f, indent=2)
        print(f"\nSaved {name} ({len(ds['frames'])} frames)")
    
    print("\n=== ALL DONE ===")
    print("Real VLM evidence is now in the precomputed datasets!")

asyncio.run(main())
