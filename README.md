# DRYLINE

**Live track condition detection for motorsport, powered by vision-language models.**

![DRYLINE demo](demo.gif)

DRYLINE watches trackside or onboard camera footage and reports, in real
time, whether the racing surface is **Dry**, **Damp**, **Wet**, or
**Drying** — and when it's drying, how many laps remain until the next
tire-compound window opens. Built for the Grand Prix AI Hackathon
(sponsor: Mphasis, Official Digital Partner of Haas F1).

## The idea

A single photo of a drying track and a photo of a damp track can be
pixel-identical. "Drying" isn't something you can see — it's a rate of
change. So DRYLINE never asks a model to output a condition directly.
Instead:

1. A vision-language model reports what it **observes** in each frame —
   surface gloss, standing water, reflections, spray, dry patches forming —
   not a label, not even a wetness number.
2. That evidence is scored into a continuous wetness value, then smoothed
   over time with a temporal filter that also tracks the *rate* of change.
3. The label is **rendered**, deterministically, from that (level, rate)
   pair. "Drying" means a wet-ish surface with a falling rate — computed,
   never guessed from a single picture.

The model is treated as a noisy sensor. Everything downstream of it is
ordinary, auditable state estimation.

A second signal comes from watching two regions per frame instead of one:
the racing line and the area just off it. The line dries first — tire heat
and airflow scrub water off the rubbered-in surface before the rest of the
track catches up. The gap between the two readings is the earliest
available warning that a tire crossover is coming, which is what turns the
tire-change suggestion into something grounded rather than decorative.

## Architecture

```
camera frame
     │
     ▼
ROI crop (on-line / off-line) + colour correction
     │
     ▼
composite image ──► hosted VLM (Gemini → Groq → OpenRouter, ordered failover)
     │                              │
     │                        structured evidence
     │                              │
     ▼                              ▼
confidence gate            evidence → wetness score
     │                              │
     └──────────────┬───────────────┘
                     ▼
           alpha-beta temporal filter
                     │
                     ▼
        level + rate → rendered label
                     │
                     ▼
     trend graph · suggestion · tire-crossover ETA
```

## Features

- **Four-state condition detection** — Dry, Damp, Wet, Drying — rendered
  from smoothed state, with hysteresis so the displayed label can't flicker
  more than once every 20 seconds.
- **Dual-ROI crossover estimate** — on-line vs. off-line divergence drives a
  laps-to-crossover projection for the next tire compound.
- **Ordered VLM failover** — Gemini → Groq → OpenRouter, with retries,
  backoff, a perceptual-hash response cache, and a rate limiter that queues
  instead of erroring. Runs on scripted synthetic data with zero API keys
  configured, so the app is always demoable.
- **Confidence gating** — blurry frames, extreme luminance, low model
  confidence, or occluded views all surface an explicit LOW CONFIDENCE state
  instead of a guess.
- **Live evidence panel** — the model's raw observations are shown next to
  the frame, not just its conclusion.
- **Naive-classifier comparison** — a plain per-frame classifier rendered
  side by side with the real pipeline, to show why the temporal-filter
  approach exists in the first place.
- **Auto-generated session notes** — a deterministic, template-based recap
  of a session's condition changes, no LLM involved.
- **Weather cross-check** — an independent agree/disagree signal from live
  Open-Meteo rain data, compared against the observed trend.
- **CSV export** of the full session trace for further analysis.

## Tech stack

FastAPI · React + Vite + Tailwind + Recharts · Gemini / Groq / OpenRouter
vision APIs · Open-Meteo · JSON-file persistence (no database).

## Getting started

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

Copy `.env.example` to `.env` and add a provider key to enable live VLM
inference — the app runs fully on scripted data with no keys set, so this
is optional for exploring the UI.

## Roadmap

- Curate the reference frame set (dry/damp/wet/standing water) and a
  library of validated demo clips.
- Precompute and commit replay sessions for a guaranteed offline demo path.
- Wire the naive-classifier comparison to an independent single-call model
  rather than a client-side approximation.
