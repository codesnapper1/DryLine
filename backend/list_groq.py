import os
import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
key = os.environ.get('GROQ_API_KEY')
resp = httpx.get('https://api.groq.com/openai/v1/models', headers={'Authorization': f'Bearer {key}'})
print([m['id'] for m in resp.json().get('data', []) if 'vision' in m['id'].lower()])
