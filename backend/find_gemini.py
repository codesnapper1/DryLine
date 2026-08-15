"""Find working Gemini model IDs."""
import asyncio, os, httpx
from dotenv import load_dotenv
import os.path
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'))

GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '')

async def main():
    models = [
        'gemini-2.5-flash-preview-05-20',
        'gemini-2.5-flash-lite-preview-06-17', 
        'gemini-2.0-flash-001',
        'gemini-1.5-flash-001',
        'gemini-2.0-flash',
    ]
    
    for mid in models:
        try:
            url = f'https://generativelanguage.googleapis.com/v1beta/models/{mid}:generateContent'
            body = {
                'contents': [{'role': 'user', 'parts': [{'text': 'Say hello'}]}]
            }
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(url, json=body, headers={'x-goog-api-key': GEMINI_KEY})
            msg = r.text[:150].replace('\n', ' ')
            print(f'{mid}: HTTP {r.status_code} -> {msg}')
            if r.is_success:
                print(f'  *** WORKING ***')
        except Exception as e:
            print(f'{mid}: ERROR {e}')

asyncio.run(main())
