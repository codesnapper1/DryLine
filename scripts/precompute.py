"""Runs each validated clip in demo/clips/ through the real API end to end
(POST /session, POST /session/{id}/video) and writes the resulting series to
demo/precomputed/<clip>.json. These files are committed so the
guaranteed-safe replay path needs zero network and zero API calls at demo
time.
"""

import os
import glob
import json
import httpx
import asyncio

API_BASE = "http://localhost:8000"

async def process_clip(clip_path):
    clip_name = os.path.basename(clip_path)
    print(f"Processing {clip_name}...")
    
    async with httpx.AsyncClient(timeout=300.0) as client:
        # Create session
        res = await client.post(f"{API_BASE}/session", json={
            "name": clip_name,
            "lap_time_s": 90.0,
            "fps_sample": 1.0 # process 1 fps
        })
        if res.status_code != 200:
            print(f"Failed to create session for {clip_name}: {res.text}")
            return
        
        session_id = res.json()["id"]
        
        # Post video
        with open(clip_path, 'rb') as f:
            files = {'video': (clip_name, f, 'video/mp4')}
            res = await client.post(f"{API_BASE}/session/{session_id}/video", files=files)
            
        if res.status_code != 200:
            print(f"Failed to process video {clip_name}: {res.text}")
            return
            
        # Get series
        res = await client.get(f"{API_BASE}/session/{session_id}/series")
        if res.status_code != 200:
            print(f"Failed to get series for {clip_name}: {res.text}")
            return
            
        series_data = res.json()
        
        # Save to precomputed
        out_dir = "../demo/precomputed"
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f"{clip_name}.json")
        with open(out_path, 'w') as f:
            json.dump(series_data, f, indent=2)
            
        print(f"Saved {clip_name} to {out_path}")

async def main():
    clips = glob.glob("../demo/clips/*.mp4")
    if not clips:
        print("No clips found in ../demo/clips/")
        return
        
    for clip in clips:
        await process_clip(clip)
        
if __name__ == "__main__":
    asyncio.run(main())

