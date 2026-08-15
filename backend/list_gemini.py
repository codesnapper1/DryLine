"""List all available Gemini models."""
import asyncio, os, httpx
from dotenv import load_dotenv
import os.path
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'))

GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '')

async def main():
    url = 'https://generativelanguage.googleapis.com/v1beta/models'
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(url, params={'key': GEMINI_KEY, 'pageSize': 100})
    print(f'Status: {r.status_code}')
    if r.is_success:
        data = r.json()
        models = data.get('models', [])
        # Filter to only show vision-capable models
        for m in models:
            name = m.get('name', '')
            supported = m.get('supportedGenerationMethods', [])
            if 'generateContent' in supported:
                print(f"  {name} -> input={m.get('supportedGenerationMethods')}")
    else:
        print(r.text[:500])

asyncio.run(main())
