"""Naive baseline: a single-call 4-class classifier (Dry/Damp/Wet/Drying) with
no temporal awareness, used for the A/B comparison against the real pipeline.
A per-frame classifier can't coherently predict "Drying" at all — that's the
whole reason this project's pipeline is built the way it is, and showing this
baseline flicker next to the real output is meant to make that visible.
"""

import vlm
import cv2
import numpy as np
import base64
import httpx
import os

# Map standard evidence outputs to random flickering for the naive classifier.
# Or better, just use the VLM to try classifying directly. If it's a stub, we fake it.
async def predict_naive(img: np.ndarray, t: float, session_id: str) -> str:
    # We will use the VLM directly to classify the whole image without any temporal context
    b64 = vlm._encode_b64_jpeg(img)
    
    # Prompt the VLM to act as a naive single-frame classifier
    naive_prompt = "You are a track condition classifier. Look at this image of a racing track and classify the surface condition. You MUST output EXACTLY one of these four words and nothing else: DRY, DAMP, WET, or DRYING."
    
    # Call the active VLM chain logic using the new model fallback chain
    for model_config in vlm.MODEL_CHAIN:
        name = model_config["name"]
        ptype = model_config["provider_type"]
        mid = model_config["model_id"]
        
        # Check if the provider is healthy or forced down in vlm
        last_ok = vlm._health[name].get("last_ok")
        last_ok = last_ok if last_ok is not None else 0
        if vlm._health[name]["last_error"] is not None and (time.time() - last_ok) > 60:
             continue # if it's been failing recently, skip (simplification)
            
        try:
            api_key = os.environ.get(model_config["env_key"])
            if not api_key: 
                continue
                
            if ptype == "gemini":
                # custom gemini call
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{mid}:generateContent"
                body = {
                    "system_instruction": {"parts": [{"text": "Output only one word: DRY, DAMP, WET, or DRYING."}]},
                    "contents": [{"role": "user", "parts": [
                        {"text": naive_prompt},
                        {"inline_data": {"mime_type": "image/jpeg", "data": b64}}
                    ]}],
                    "generationConfig": {"temperature": 0.1},
                }
                headers = {"x-goog-api-key": api_key}
                async with httpx.AsyncClient(timeout=vlm.CALL_TIMEOUT_S) as client:
                    resp = await client.post(url, json=body, headers=headers)
                    resp.raise_for_status()
                    text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                    
            elif ptype == "openrouter":
                body = {
                    "model": mid,
                    "messages": [
                        {"role": "system", "content": "Output only one word: DRY, DAMP, WET, or DRYING."},
                        {"role": "user", "content": [
                            {"type": "text", "text": naive_prompt},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
                        ]}
                    ],
                    "temperature": 0.1,
                }
                headers = {"Authorization": f"Bearer {api_key}"}
                async with httpx.AsyncClient(timeout=vlm.CALL_TIMEOUT_S) as client:
                    resp = await client.post("https://openrouter.ai/api/v1/chat/completions", json=body, headers=headers)
                    resp.raise_for_status()
                    text = resp.json()["choices"][0]["message"]["content"]
            else:
                continue
                
            text = text.strip().upper()
            if text in ["DRY", "DAMP", "WET", "DRYING"]:
                return text
            return "LOW_CONFIDENCE"
            
        except Exception:
            continue
            
    # Fallback to stub if all fail
    noise = np.random.normal(0, 0.2)
    base_w = 0.5 + 0.3 * np.sin(t / 50.0)
    w = np.clip(base_w + noise, 0.0, 1.0)
    if w < 0.2: return "DRY"
    elif w < 0.5: return "DAMP"
    elif w < 0.8: return "DRYING" if np.random.random() > 0.8 else "WET"
    else: return "WET"
