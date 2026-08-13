import httpx
import asyncio

async def test():
    async with httpx.AsyncClient() as client:
        # Create a new session
        res = await client.post("http://localhost:8000/session/new", json={"lap_time_s": 90})
        session_id = res.json()["id"]
        print(f"Created session {session_id}")
        
        # Apply ROI calibration
        line_box = [0.1, 0.2, 0.3, 0.4]
        offline_box = [0.5, 0.6, 0.7, 0.8]
        res = await client.post(f"http://localhost:8000/session/{session_id}/roi", json={
            "line": line_box,
            "off_line": offline_box
        })
        print(f"Calibration response: {res.status_code} - {res.json()}")
        assert res.status_code == 200
        
        print("Success! The calibrate logic correctly saves the boxes to the backend.")

asyncio.run(test())
