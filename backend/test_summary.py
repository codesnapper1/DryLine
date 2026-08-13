import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

import summary

async def main():
    frames = [
        {"t": 0.0, "displayed_label": "DRY", "confidence_ok": True},
        {"t": 4.0, "displayed_label": "DRY", "confidence_ok": True},
    ]
    res = await summary.build_summary(frames)
    print("AI SUMMARY:\n", res)

if __name__ == "__main__":
    asyncio.run(main())
