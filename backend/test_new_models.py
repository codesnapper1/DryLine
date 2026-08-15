"""Test new-format Gemini models that showed in the list."""
import asyncio, os, base64, httpx, numpy as np, cv2, json
from dotenv import load_dotenv
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

async def test_gemini_full(model_id, b64):
    """Test with full vision prompt."""
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent'
    body = {
        'contents': [{'role': 'user', 'parts': [
            {'text': 'Is this a wet or dry racing track? Answer: WET or DRY'},
            {'inline_data': {'mime_type': 'image/jpeg', 'data': b64}}
        ]}],
        'generationConfig': {'temperature': 0.1, 'maxOutputTokens': 20},
    }
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(url, json=body, headers={'x-goog-api-key': GEMINI_KEY})
    print(f'  {model_id}: HTTP {r.status_code}')
    if r.is_success:
        d = r.json()
        print(f'  FULL RESPONSE: {json.dumps(d, indent=2)[:500]}')
        return True
    else:
        err_data = r.json() if r.headers.get('content-type','').startswith('application/json') else {}
        msg = err_data.get('error', {}).get('message', r.text[:100])
        print(f'  ERROR: {msg[:150]}')
    return False

async def test_groq_vision(model_id, b64):
    """Find Groq vision models."""
    body = {
        'model': model_id,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': 'Is this track wet or dry? Say WET or DRY.'},
            {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}}
        ]}],
        'temperature': 0.1, 'max_tokens': 10,
    }
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post('https://api.groq.com/openai/v1/chat/completions', json=body, headers={'Authorization': f'Bearer {GROQ_KEY}'})
    print(f'  groq/{model_id}: HTTP {r.status_code}')
    if r.is_success:
        d = r.json()
        text = d['choices'][0]['message']['content']
        print(f'  SUCCESS: {text}')
        return True
    else:
        err = r.json().get('error', {}).get('message', r.text[:80])
        print(f'  FAIL: {err[:120]}')
    return False

async def list_groq_models():
    """List available Groq models."""
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get('https://api.groq.com/openai/v1/models', headers={'Authorization': f'Bearer {GROQ_KEY}'})
    if r.is_success:
        d = r.json()
        for m in d.get('data', []):
            if 'vision' in m.get('id', '').lower() or 'llava' in m.get('id','').lower() or 'scout' in m.get('id','').lower():
                print(f"  GROQ VISION MODEL: {m['id']}")
    
async def main():
    print('Getting test image...')
    b64 = await get_test_image()
    print('Ready.\n')
    
    print('=== GROQ AVAILABLE MODELS (vision-capable) ===')
    await list_groq_models()
    
    print('\n=== TESTING NEW GEMINI MODELS (from API list) ===')
    new_models = [
        'gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-flash-latest',
        'gemini-3.1-flash-lite', 'gemini-2.5-flash-image',
    ]
    for mid in new_models:
        try:
            await test_gemini_full(mid, b64)
        except Exception as e:
            print(f'  EXCEPTION: {mid} -> {e}')
    
    print('\n=== TESTING GROQ VISION MODELS ===')
    # List all Groq models first
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get('https://api.groq.com/openai/v1/models', headers={'Authorization': f'Bearer {GROQ_KEY}'})
    if r.is_success:
        d = r.json()
        all_models = [m['id'] for m in d.get('data', [])]
        print(f'All Groq models: {all_models}')
        # Test all that might support vision
        for mid in all_models:
            if any(k in mid.lower() for k in ['vision', 'llava', 'scout', 'maverick', 'llama-4']):
                try:
                    await test_groq_vision(mid, b64)
                except Exception as e:
                    print(f'  ERROR: {e}')

asyncio.run(main())
