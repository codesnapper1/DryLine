#!/bin/bash
echo "Starting DRYLINE..."
echo "Make sure you have run npm install in frontend and pip install in backend!"

cd backend
../.venv/bin/python -m uvicorn main:app --port 8000 &
BACKEND_PID=$!

cd ../frontend
npm run dev &
FRONTEND_PID=$!

echo "DRYLINE is running! Backend on :8000, Frontend on :5173."
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID" EXIT
wait
