"""Test which available Gemini models work for vision tasks."""
import asyncio, os, base64, httpx, numpy as np, cv2
from dotenv import load_dotenv
import os.path
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'))

GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '')
GROQ_KEY = os.environ.get('GROQ_API_KEY', '')

async def get_test_image():
    url = 'https://source.roboflow.com/B6Cl7Potd0SZ0ha2dxqp5AEnVsS2/GgWTD90IE8HjaXlSjac5/thumb.jpg'
    async with httpx.AsyncClient() as c:
        r = await c.get(url)
    arr = np.frombuffer(r.content, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    ok, buf = cv2.imencode('.jpg', img)
    return base64.b64encode(buf.tobytes()).decode()

async def test_gemini(model_id, b64):
    # Use the model ID without 'models/' prefix
    mid = model_id.replace('models/', '')
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{mid}:generateContent'
    body = {
        'contents': [{'role': 'user', 'parts': [
            {'text': 'Is this racing track wet or dry? Reply in one word.'},
            {'inline_data': {'mime_type': 'image/jpeg', 'data': b64}}
        ]}],
        'generationConfig': {'temperature': 0.1, 'maxOutputTokens': 50},
    }
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(url, json=body, headers={'x-goog-api-key': GEMINI_KEY})
    if r.is_success:
        d = r.json()
        text = d['candidates'][0]['content']['parts'][0]['text']
        print(f'  *** WORKS: {mid} -> {text[:60]}')
        return True
    else:
        err = r.json().get('error', {}).get('message', r.text[:80])
        print(f'  FAIL: {mid} -> {err[:100]}')
        return False

async def test_groq(model_id, b64):
    body = {
        'model': model_id,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': 'Is this track wet? One word answer.'},
            {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}}
        ]}],
        'temperature': 0.1, 'max_tokens': 20,
    }
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post('https://api.groq.com/openai/v1/chat/completions', json=body, headers={'Authorization': f'Bearer {GROQ_KEY}'})
    if r.is_success:
        d = r.json()
        text = d['choices'][0]['message']['content']
        print(f'  *** WORKS: groq/{model_id} -> {text[:60]}')
        return True
    else:
        err = r.json().get('error', {}).get('message', r.text[:80])
        print(f'  FAIL: groq/{model_id} -> {err[:100]}')
        return False

async def main():
    print('Downloading test image...')
    b64 = await get_test_image()
    print('Image ready. Testing models...\n')
    
    # Test the models actually listed by the API
    gemini_candidates = [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-flash-latest',
        'gemini-3.5-flash',
        'gemini-3.7-flash',
        'gemini-2.5-flash-lite',
    ]
    print('=== GEMINI (vision-capable) ===')
    for mid in gemini_candidates:
        try:
            await test_gemini(mid, b64)
        except Exception as e:
            print(f'  ERROR: {mid} -> {e}')
    
    # Groq - check their current model list
    groq_candidates = [
        'llama-4-scout-17b-16e-instruct',
        'meta-llama/llama-4-scout-17b-16e-instruct',
        'llama-4-maverick-17b-128e-instruct',
        'llama-3.3-70b-versatile',
    ]
    print('\n=== GROQ (vision) ===')
    for mid in groq_candidates:
        try:
            await test_groq(mid, b64)
        except Exception as e:
            print(f'  ERROR: groq/{mid} -> {e}')

asyncio.run(main())
