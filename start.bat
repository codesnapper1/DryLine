@echo off
echo Starting DRYLINE...
echo Make sure you have run npm install in frontend and pip install in backend!

start cmd /k "cd backend && ..\.venv\Scripts\python.exe -m uvicorn main:app --port 8000"
start cmd /k "cd frontend && npm run dev"

echo DRYLINE is running! Backend on :8000, Frontend on :5173.
