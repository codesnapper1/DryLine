import asyncio
import os
from dotenv import load_dotenv

# load env vars
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

import vlm

async def main():
    print("Providers configured:", vlm.any_provider_configured())
    # Create a dummy image
    import cv2
    import numpy as np
    
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    b64 = vlm._encode_b64_jpeg(img)
    
    # Try calling the chain directly
    try:
        preds, source = await vlm._call_chain(b64, [])
        print("Success! Source:", source)
        print("Predictions:", preds)
    except Exception as e:
        print("Failed:", e)

if __name__ == "__main__":
    asyncio.run(main())
