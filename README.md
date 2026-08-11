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

### Built and working

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

### Planned

- A curated reference frame set (dry/damp/wet/standing water) and a library
  of validated demo clips, cut from real trackside/onboard footage.
- Precomputed, committed replay sessions for a guaranteed offline demo path
  with zero network dependency at demo time.
- An independent single-call baseline model behind the naive-classifier
  comparison, replacing today's client-side approximation.
- A judge-facing clip picker for live, on-demand inference during review.

## Research & related work

**Structured evidence extraction instead of a direct answer.** Vision-language
models are known to be unreliable at precise numeric estimation but far more
consistent when asked to report discrete, observable attributes — especially
when given few-shot visual references to compare against, a well-documented
property of in-context learning in large language and vision-language models
alike (Brown et al., *Language Models are Few-Shot Learners*, NeurIPS 2020;
Bai et al., *Qwen-VL*, 2023). DRYLINE sends four reference images
(dry/damp/wet/standing water) with every call and asks for schema-constrained
JSON evidence rather than a wetness percentage, for exactly this reason.

**A temporal filter instead of a bigger model.** Treating "drying" as a rate
of change rather than a visual class is a direct application of classical
recursive state estimation — the alpha-beta (g-h) filter used here is a
steady-state simplification of the Kalman filter (Kalman, *A New Approach to
Linear Filtering and Prediction Problems*, 1960), the same family of
techniques used from spacecraft navigation to modern object tracking.

**Why this is visually tractable at all.** Road and track surface wetness is
a well-studied computer vision problem. Large annotated datasets such as
RSCD (Road Surface Classification Dataset, ~1M images across six
friction-level classes including dry, wet, standing water, and snow/ice) and
dedicated CNN classifiers evaluated on real driving footage have demonstrated
90%+ accuracy distinguishing dry from wet surfaces from ordinary camera
images. That prior work establishes the underlying visual signal is real and
learnable — which is exactly why a general-purpose VLM, with no training of
its own, can pick it up too.

**Why this matters for race strategy.** Tire-change timing is an active area
of motorsport analytics research, not a toy problem: Heilmeier et al. (TU
Munich / BMW Motorsport, *Applied Sciences*, 2020) built a neural pit-stop
decision system trained on six seasons of Formula 1 timing data, and more
recent work (*Frontiers in Artificial Intelligence*, 2025) applies deep
learning directly to pit-stop decision support. DRYLINE's crossover estimate
is aimed at feeding exactly this kind of decision with an earlier,
physically-grounded signal than lap-time delta alone.

References:
- Kalman, R. E. (1960). *A New Approach to Linear Filtering and Prediction Problems.*
- Brown, T. et al. (2020). [*Language Models are Few-Shot Learners.*](https://arxiv.org/abs/2005.14165) NeurIPS.
- Bai, J. et al. (2023). [*Qwen-VL: A Versatile Vision-Language Model.*](https://arxiv.org/abs/2308.12966)
- [*RSCD: A road surface image dataset with detailed annotations for driving assistance applications.*](https://www.sciencedirect.com/science/article/pii/S2352340922006771)
- Heilmeier, A. et al. (2020). [*Virtual Strategy Engineer: Using Artificial Neural Networks for Making Race Strategy Decisions in Circuit Motorsport.*](https://www.mdpi.com/2076-3417/10/21/7805) Applied Sciences.
- [*Data-driven pit stop decision support for Formula 1 using deep learning models.*](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1673148/full) Frontiers in AI (2025).

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
