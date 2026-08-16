# DryLine — Strategy & Reliability Upgrade

Hackathon-ready extension for **Weather Whiplash: Live Track Condition Detector**.

This package focuses on the additions requested after the original DryLine review:

- tyre health and tyre-age modelling
- tyre-set / tyre-change conservation
- track/tyre compatibility scoring
- stay-out / prepare / pit / strategic-hold decisions
- sudden-rain (`WETTING`) and weather-whiplash detection
- crossover ETA as a range rather than fake precision
- separate vision confidence and strategy confidence
- frame quality gate (blur / exposure / frozen / stale feed)
- rejected-frame behaviour that preserves the last reliable state
- sensor disagreement and system-health status
- racing-line vs off-line wetness inputs
- deterministic, explainable race-engineer reasons
- React dashboard showing all of the above

## Structure

```text
backend/
  main.py              FastAPI application
  models.py            API/data models
  decision.py          temporal + tyre strategy engine
  quality.py           image quality / bad-feed checks
  vision_adapter.py    deterministic CV fallback + structured-input adapter
  state.py             per-session state
  tests/test_strategy.py
frontend/
  src/App.jsx
  src/components/*
```

## Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Swagger: `http://localhost:8000/docs`

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Key integration path for the existing DryLine vision model

If your existing repo already produces wetness/evidence, keep it. Call:

`POST /api/ingest-observation`

with structured observations instead of replacing your VLM. That endpoint applies the new temporal, tyre-resource, crossover, failure and confidence logic.

Example:

```json
{
  "session_id": "demo",
  "observation": {
    "wetness": 0.42,
    "racing_line_wetness": 0.31,
    "offline_wetness": 0.64,
    "standing_water": 0.18,
    "spray": 0.2,
    "rain_intensity": 0.25,
    "vision_confidence": 0.9,
    "frame_quality": 0.95,
    "track_visible": true,
    "timestamp": 1720000000
  },
  "tyre": {
    "compound": "MEDIUM",
    "health": 0.86,
    "age_laps": 13,
    "temperature_c": 88,
    "changes_remaining": 1,
    "pit_loss_seconds": 21.5
  },
  "weather": {
    "rain_intensity": 0.3,
    "rain_expected_minutes": 5,
    "confidence": 0.8
  },
  "lap_time_seconds": 92
}
```

## Important design rule

A bad image never produces a new tyre recommendation. Rejected or stale frames keep the last reliable state and lower system confidence; sufficiently stale data becomes `UNKNOWN`.
