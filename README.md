# DRYLINE

**Weather Whiplash: Live Track Condition Detector** — Grand Prix AI Hackathon
online qualifier submission. See [CLAUDE.md](CLAUDE.md) for the full
architecture and constraints, [PLAN.md](PLAN.md) for build phases and status.

DRYLINE treats the four required labels differently on purpose: **Dry**,
**Damp**, and **Wet** are appearances a vision-language model can observe in a
single frame; **Drying** is a time derivative it cannot. A hosted VLM reports
structured visual evidence per frame (gloss, standing water, spray, dry
patches forming); a deterministic alpha-beta filter turns that into a
smoothed wetness level and rate; the label is *rendered* from the
(level, rate) pair, not predicted directly. See CLAUDE.md section 2 before
changing that split.

## Compliance table

Every line of the organizers' problem statement, mapped to the file and
endpoint that satisfies it. Status is honest as of the last update — `stub`
means the pipeline stage exists and is wired end to end, but is driven by a
scripted placeholder rather than the real hosted VLM yet (PLAN.md Phase 1-2
vs Phase 3).

| Problem statement line | File(s) | Endpoint | Status |
|---|---|---|---|
| "Feed in images or short video frames from a camera (trackside or onboard)." | [backend/main.py](backend/main.py) | `POST /session/{id}/frame`, `POST /session/{id}/video` | done |
| "The AI looks at each image and tells you if the track looks Dry, Damp, Wet, or Drying." | [backend/vlm.py](backend/vlm.py), [backend/decision.py](backend/decision.py) | `GET /session/{id}/decision` | stub (scripted decider; real VLM is Phase 3) |
| "Over time, it shows a simple trend: is the track getting better or worse?" | [backend/temporal.py](backend/temporal.py), [frontend/src/components/TrendChart.tsx](frontend/src/components/TrendChart.tsx) | `GET /session/{id}/series` | done |
| "...it gives a suggestion like 'Consider tire change soon.'" | [backend/decision.py](backend/decision.py) (`SUGGESTIONS`), [frontend/src/components/InsightPanel.tsx](frontend/src/components/InsightPanel.tsx) | `GET /session/{id}/decision` | done — includes the verbatim string, see below |
| "Input: photos or video frames, basic weather info (optional)." | [backend/main.py](backend/main.py), [backend/weather.py](backend/weather.py) | `POST /session/{id}/frame`, `POST /session/{id}/video` | weather.py not wired yet (planned) |
| "Output: a label per image, a simple trend graph, and a suggestion message." | [backend/main.py](backend/main.py) | `GET /session/{id}/decision`, `GET /session/{id}/series`, `GET /session/{id}/export.csv` | done |
| **Frontend:** uploaded image, predicted condition, trend line, all on one screen. | [frontend/src/App.tsx](frontend/src/App.tsx) | — | done |
| **Backend:** where images are processed and the AI decides the condition. | [backend/main.py](backend/main.py), [backend/vlm.py](backend/vlm.py) | full API | stub decider, real pipeline wiring done |
| UI must literally display **Dry / Damp / Wet / Drying**. | [frontend/src/components/StatusChip.tsx](frontend/src/components/StatusChip.tsx) | — | done |
| Suggestion string exactly `"Track drying: tire change window approaching."` | [backend/decision.py](backend/decision.py) (`SUGGESTIONS["DRYING"]`) | `GET /session/{id}/decision` | done, verbatim |

## Running it

See [CLAUDE.md](CLAUDE.md) for environment setup (this machine's `python3` on
PATH is an MSYS2 build with no matching wheels for numpy/opencv — use
`py -3.14 -m venv .venv` instead, see CLAUDE.md's Environment section).

```bash
cd backend && ../.venv/Scripts/python.exe -m uvicorn main:app --port 8000
```
```bash
cd frontend && npm install && npm run dev
```

The app boots and serves cached/precomputed sessions with **zero API keys
set**. Live VLM inference (PLAN.md Phase 3) needs at least one provider key —
copy [.env.example](.env.example) to `.env` and fill in what you have.

## Non-goals

No auth, no user accounts, no database (JSON on disk), no Docker, no cloud
deploy, no model training, no automatic road segmentation, no mobile layout.
See CLAUDE.md section 10 for the full list and why.
