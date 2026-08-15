"""Quick model availability tester - run to find working model IDs."""
import asyncio, os, base64, json, httpx, sys, numpy as np, cv2
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '')
GROQ_KEY = os.environ.get('GROQ_API_KEY', '')
OR_KEY = os.environ.get('OPENROUTER_API_KEY', '')

SIMPLE_PROMPT = 'Describe this racing track surface in one sentence. Output JSON: {"surface_gloss": "none", "wetness_0_100": 0, "note": ""}'

async def get_test_image():
    url = 'https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/GgWTD90IE8HjaXlSjac5/thumb.jpg'
    async with httpx.AsyncClient() as c:
        r = await c.get(url)
    arr = np.frombuffer(r.content, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    ok, buf = cv2.imencode('.jpg', img)
    return base64.b64encode(buf.tobytes()).decode()

async def test_gemini(model_id, b64):
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent'
    body = {
        'contents': [{'role': 'user', 'parts': [
            {'text': SIMPLE_PROMPT},
            {'inline_data': {'mime_type': 'image/jpeg', 'data': b64}}
        ]}],
        'generationConfig': {'temperature': 0.1},
    }
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(url, json=body, headers={'x-goog-api-key': GEMINI_KEY})
    print(f'  gemini/{model_id}: {r.status_code}')
    if r.is_success:
        d = r.json()
        print(f'    -> {d["candidates"][0]["content"]["parts"][0]["text"][:150]}')
        return True
    else:
        print(f'    -> {r.text[:120]}')
    return False

async def test_groq(model_id, b64):
    body = {
        'model': model_id,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': SIMPLE_PROMPT},
            {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}}
        ]}],
        'temperature': 0.1, 'max_tokens': 200,
    }
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post('https://api.groq.com/openai/v1/chat/completions', json=body, headers={'Authorization': f'Bearer {GROQ_KEY}'})
    print(f'  groq/{model_id}: {r.status_code}')
    if r.is_success:
        d = r.json()
        print(f'    -> {d["choices"][0]["message"]["content"][:150]}')
        return True
    else:
        print(f'    -> {r.text[:120]}')
    return False

async def test_openrouter(model_id, b64):
    body = {
        'model': model_id,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': SIMPLE_PROMPT},
            {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}}
        ]}],
        'temperature': 0.1, 'max_tokens': 200,
    }
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post('https://openrouter.ai/api/v1/chat/completions', json=body, headers={'Authorization': f'Bearer {OR_KEY}'})
    print(f'  openrouter/{model_id}: {r.status_code}')
    if r.is_success:
        d = r.json()
        print(f'    -> {d["choices"][0]["message"]["content"][:150]}')
        return True
    else:
        print(f'    -> {r.text[:200]}')
    return False

async def main():
    print('Downloading test image...')
    b64 = await get_test_image()
    print('Image ready.\n')
    
    print('=== GEMINI MODELS ===')
    for mid in ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-002']:
        try:
            ok = await test_gemini(mid, b64)
            if ok: print(f'    *** WORKING: gemini/{mid} ***')
        except Exception as e:
            print(f'  gemini/{mid}: EXCEPTION {e}')
    
    print('\n=== GROQ MODELS ===')
    for mid in ['llama-3.2-90b-vision-preview', 'llama-3.2-11b-vision-preview', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llava-v1.5-7b-4096-preview']:
        try:
            ok = await test_groq(mid, b64)
            if ok: print(f'    *** WORKING: groq/{mid} ***')
        except Exception as e:
            print(f'  groq/{mid}: EXCEPTION {e}')
    
    print('\n=== OPENROUTER MODELS (free vision) ===')
    for mid in ['google/gemini-2.0-flash-exp:free', 'google/gemini-flash-1.5-8b', 'mistralai/mistral-small-3.2-24b-instruct:free', 'meta-llama/llama-4-scout:free']:
        try:
            ok = await test_openrouter(mid, b64)
            if ok: print(f'    *** WORKING: openrouter/{mid} ***')
        except Exception as e:
            print(f'  openrouter/{mid}: EXCEPTION {e}')

asyncio.run(main())
