"""Full end-to-end test: VLM chain with gemini-3.1-flash-lite on a real roboflow image."""
import asyncio, os, base64, json, httpx, numpy as np, cv2, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'))

import prompts, vlm, cv_analysis

async def get_image(url: str) -> np.ndarray:
    async with httpx.AsyncClient() as c:
        r = await c.get(url)
    arr = np.frombuffer(r.content, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)

async def main():
    urls = [
        "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/GgWTD90IE8HjaXlSjac5/thumb.jpg",
        "https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/PldZaAZYkxcvYclgvyrW/thumb.jpg",
    ]
    
    print("=== CV ANALYSIS (always works, no API) ===")
    import roi as roi_mod
    for url in urls:
        img = await get_image(url)
        rois = roi_mod.process_rois(img, {
            "line": (0.35, 0.55, 0.30, 0.35),
            "off_line": (0.05, 0.55, 0.25, 0.35),
        })
        cv_ev = cv_analysis.analyze_frame(rois)
        for name, ev in cv_ev.items():
            print(f"  {name}: wetness={ev['wetness_0_100']}%, gloss={ev['surface_gloss']}, entropy={ev['texture_entropy']:.2f}, spec={ev['specularity_score']:.4f}")
    
    print("\n=== VLM CHAIN TEST (gemini-3.1-flash-lite) ===")
    img = await get_image(urls[0])
    b64 = vlm._encode_b64_jpeg(img)
    anchor_b64s = [base64.b64encode(b).decode() for b in prompts.load_anchor_bytes()]
    print(f"Providers configured: {vlm.configured_providers()}")
    
    try:
        ev, provider = await vlm._call_chain(b64, anchor_b64s)
        print(f"SUCCESS via {provider}")
        print(json.dumps(ev, indent=2))
    except Exception as e:
        print(f"VLM FAILED: {e}")
        print("Falling back to CV analysis only (this is fine for demo)")

asyncio.run(main())
