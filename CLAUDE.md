# DRYLINE — CLAUDE.md

Hackathon submission for the Grand Prix AI Hackathon online qualifier (F1/motorsport
theme, sponsor Mphasis — Official Digital Partner of Haas F1). Judges review the
repo + demo video online, then we pitch live. This file is the authoritative
architecture and constraint reference for anyone (human or Claude) working in this
repo. Read it before touching code.

**Architecture note for anyone reading git history:** this project originally
planned a locally-trained ordinal-regression ONNX model (CORN loss, timm
efficientnet_b0). That plan is superseded. The current architecture uses a hosted
vision-language model as the per-frame decider — see section 3. There is no
training pipeline in this repo; if you find references to one in old commits,
they're dead.

## 1. Problem statement we must satisfy (verbatim, do not drift from this)

> **Weather Whiplash: Live Track Condition Detector.** Track conditions (dry, wet,
> drying) can change faster than weather reports keep up. Teams need to know right
> now if the track is becoming safer or riskier, so they can decide when to change
> tires.
> - Feed in images or short video frames from a camera (trackside or onboard).
> - The AI looks at each image and tells you if the track looks Dry, Damp, Wet, or Drying.
> - Over time, it shows a simple trend: is the track getting better or worse?
> - Based on this, it gives a suggestion like "Consider tire change soon."
>
> **Frontend:** a screen showing the uploaded image, the predicted condition, and a
> trend line/graph over time. **Backend:** where images are processed and the AI
> decides the condition. **Input:** photos or video frames, basic weather info
> (optional). **Output:** a label per image (Dry, Damp, Wet, Drying), a simple trend
> graph, and a suggestion message.

**Compliance rules — non-negotiable:**
- The UI must literally display the four words: **Dry, Damp, Wet, Drying**. Never rename them.
- One suggestion string must be exactly: `"Track drying: tire change window approaching."`
- Uploaded image, predicted condition, and trend graph must all be visible on one screen.
- `README.md` must contain a table mapping every line of the statement above to the
  file and endpoint that satisfies it. Reviewers grade against the brief — make it trivial.

We satisfy the brief literally, then exceed it underneath.

## 2. Core technical insight (drives the whole architecture)

**"Drying" is NOT a per-frame visual class. It is a TIME DERIVATIVE.** A single frame
of a drying track is pixel-identical to a frame of a damp track. Any system that asks
a model to output one of {Dry, Damp, Wet, Drying} per image has an incoherent label
space — three describe appearance, one describes history — and it will flicker.

Therefore:
- The **VLM decides the condition per frame** as a continuous wetness scalar `W ∈ [0,1]`,
  derived from structured visual evidence (section 4), not asked for the label directly.
- A **temporal filter** derives smoothed level `Ŵ` and rate `dŴ/dt`.
- The **label is rendered** from the `(Ŵ, dŴ/dt)` pair. "Drying" = wet-ish level with a
  significantly negative rate. It is computed, never guessed from a picture.

Do not let any future change collapse this back into a single call that outputs one
of the four labels directly. If someone proposes that, point them at this section.

**Second insight — dual ROI is the differentiator.** We sample two regions: one **ON
the racing line**, one **OFF it**. A track dries on the racing line first (tire heat +
car airflow scrubs water off the rubbered-in line before the rest of the surface). The
divergence between the two channels is the earliest possible signal that a tire
crossover (wet → inter → slick) is coming. This is what makes the "tire change window"
suggestion meaningful instead of decorative.

## 3. Architecture — hosted VLM, no training, no local models

The problem statement requires that "the AI decides the condition," so a
**vision-language model is the per-frame decider**. There is no dataset, no
labelling, no training run, no ONNX, no GPU, no Ollama, no local weights.

```
frames ──► ROI crops ──► composite ──► hosted VLM ──► evidence JSON
                                                            │
                                                    evidence scoring
                                                            │
                                            α-β filter ─────┴──► Ŵ, dŴ/dt
                                                                     │
                                              label render + crossover + suggestion
```

**Framing (use this in the UI and README):** the VLM is a *sensor with noise*;
everything downstream is *state estimation*. Perception is learned (via a hosted
model we didn't train), decision is deterministic and auditable (ours, in
`temporal.py` and `decision.py`).

### Provider chain — ordered failover, exponential backoff

Single `VLMProvider` interface in `backend/vlm.py`, runtime-switchable, current
provider shown in the UI:

1. **Google AI Studio** — `gemini-2.5-flash`, JSON schema mode (primary)
2. **Groq** — Llama 4 Scout vision (fast fallback)
3. **OpenRouter** — any `:free` vision model (insurance)

Keys from `.env` (see `.env.example`), never committed. **The app must start and
serve cached/precomputed sessions with zero keys set.** If every provider fails:
clear banner, fall back to cache, never crash, never show a stale label as if it
were live.

### Call budget — hard requirements

Naive = 720 calls/min of video. These four rules bring it to ~30:

- Video sampled at **0.5 fps** (water depth does not change in 500ms — physically
  justified, state this in the README).
- **Composite both ROI crops into ONE image per call**, side by side, labelled
  `A: RACING LINE` / `B: OFF-LINE`. One JSON returns both. (`roi.py`'s composite
  builder — see its docstring; not built yet.)
- **Self-consistency (3 samples, median) only in single-image mode.** Video = 1 sample.
- **Perceptual-hash (dhash) cache** in `demo/cache/`. Cache hit = zero API calls.
- Token-bucket rate limiter, configurable RPM, **queues rather than errors**.

## 4. The VLM prompt (core IP — get this exactly right)

VLMs are unreliable at absolute numeric estimation and reliable at reporting
observations. Extract **structured evidence**, then score deterministically.

Send 4 few-shot anchor crops (dry / damp / wet / standing water, from
`demo/anchors/`) with **every** request — turns absolute judgment into comparison
and collapses variance.

```python
SYSTEM = """You are a motorsport track-surface analyst. You will see a composite
image containing two cropped regions of racing circuit tarmac, labelled A and B.
Report ONLY what is visually observable. Output strict JSON. No prose, no markdown."""

USER = """The four reference images above show, in order: DRY, DAMP, WET, STANDING WATER.

Analyse region A (racing line) and region B (off-line) in the target image.
Return exactly this JSON:
{
  "A": {
    "surface_gloss":       "none" | "slight" | "moderate" | "mirror_like",
    "reflections_visible": true | false,
    "standing_water":      "none" | "patches" | "continuous",
    "spray_from_cars":     "none" | "light" | "heavy" | "not_visible",
    "dry_patches_forming": "none" | "emerging" | "dominant",
    "wetness_0_100":       <int>,
    "confidence_0_100":    <int>
  },
  "B": { ...same fields... },
  "occluded_or_unclear": true | false,
  "note": "<one short sentence of visual justification>"
}

Judge by reflections and standing water, NOT brightness alone — shadows and low sun
make dry tarmac look dark or glossy. This is the most common error; avoid it."""
```

### Evidence scoring (`backend/decision.py`)

Do not trust `wetness_0_100` alone:

```python
W_ev = clamp(0.20*gloss + 0.35*standing + 0.15*reflections
             + 0.20*spray - 0.30*dry_patches, 0, 1)
W    = 0.7*W_ev + 0.3*(wetness_0_100/100)   # evidence dominates
```

**Bonus signal:** `dry_patches_forming` gives a *spatial* drying observation from a
single frame, independent of the temporal derivative. When both agree, raise
confidence. Surface this in the UI as "two independent drying signals."

Implemented (`decision.evidence_to_w`). Everything downstream of `W` — the alpha-beta
filter, thresholds, label render, crossover, suggestion strings — was untouched by
this landing, exactly as planned; it just started receiving real `W` values instead
of the scripted stub's, whenever a provider key is configured.

## 5. Decision logic (deterministic, auditable)

**Temporal filter** (`backend/temporal.py`, done): alpha-beta filter, `alpha=0.15`,
`beta=0.005`, `dt` from real timestamps. Outputs `Ŵ` and `dŴ/dt` per minute.
Hysteresis with a **20-second minimum dwell time** on the displayed label — a chip
flickering Damp/Wet/Damp destroys credibility in ten seconds. Never interpolates
across a timestamp gap larger than 30s; it resets instead (section 6).

**Level thresholds on `Ŵ`** (`backend/decision.py`, done):
- dry: `< 0.15`
- damp: `0.15 – 0.40`
- wet: `0.40 – 0.70`
- standing water: `> 0.70` (displays as WET per the brief's 4-label contract; the
  "standing water" detail lives in the underlying data, not the headline label)

**Rate** (per minute, computed on the racing-line ROI's `Ŵ`):
- stable: `|dŴ/dt| < 0.02`
- negative: drying
- positive: worsening

**Label render** (never predicted directly):
```
level >= damp AND rate <= -0.02  ->  "DRYING"
else                             ->  "DRY" / "DAMP" / "WET"  (per level)
```

**Crossover:** monotone lookup `Ŵ → grip index → lap-time delta` for
`{wet, inter, slick}` tire compounds.
`laps_to_crossover = (Ŵ_line − W_crossover) / (−dŴ/dt)`, converted to laps via
estimated lap time.

**Suggestion strings — advisory language only.** "consider", "window approaching".
Never an imperative. This is decision support; a human makes the call. The DRYING
case is always exactly `"Track drying: tire change window approaching."` — do not
make it conditional or add detail into that string; put extra detail (ETA laps,
target compound) in a separate structured field instead.

## 6. Confidence / OOD gate

Display **LOW CONFIDENCE** and do NOT guess when any of:
- Laplacian variance below the blur threshold (`roi.py`, done — real, not stubbed)
- Mean luminance out of range — night / blown-out exposure (`roi.py`, done)
- VLM `confidence_0_100` low, `occluded_or_unclear` true, or self-consistency spread
  high (`main.py`, done — only meaningful once a provider is configured; the stub
  always reports fixed values that never trip these)
- Timestamp gap too large → **widen the confidence band, never interpolate across
  it** (`temporal.py`, done — the filter resets rather than pretending continuity)

**Fail loud.** Never hold and redisplay the last good label as if it were live.

## 7. Repo structure

```
backend/
  vlm.py         provider chain, failover, backoff, rate limiter, dhash cache. Done,
                 verified via a mocked-provider test (no real API keys touched by
                 me — see PLAN.md Phase 3 for what that does and doesn't prove).
                 Auto-falls-back to the original scripted sine-plus-noise stub
                 whenever zero provider keys are configured — see its docstring.
  prompts.py     system + user prompt, anchor image loading. Done — degrades
                 gracefully with 0-4 anchors present (demo/anchors/ is Phase 4).
  roi.py         ROI crop, Shades-of-Gray colour constancy (p=6), blur/luminance
                 gate checks, build_composite() (side-by-side A/B image). Done.
  decision.py    evidence_to_w() scoring + label render + crossover + suggestion
                 strings. Done.
  temporal.py    alpha-beta filter + hysteresis. Done.
  weather.py     Open-Meteo (keyless), disk-cached (15min TTL), always falls
                 back to cache — verified live against the real API (Silverstone
                 coords) and with a mocked network-outage test. Done, wired to
                 GET /session/{id}/weather.
  summary.py     build_summary(): deterministic race-engineer's-notes recap of
                 a session's label transitions — template strings over the
                 already-recorded frame history, zero LLM. Done, wired to
                 GET /session/{id}/summary. See section 10.
  baseline.py    naive single-call 4-class classifier for the A/B comparison.
                 Not built yet — PLAN.md Phase 5.
  store.py       JSON-file session persistence (no database, per non-goals). Done.
  main.py        FastAPI: POST /session, POST /session/{id}/frame,
                 POST /session/{id}/video, GET /session/{id}/series,
                 GET /session/{id}/decision, GET /session/{id}/export.csv,
                 GET /providers, POST /providers/select, GET /session/{id}/summary,
                 GET /session/{id}/weather — all done. Ingest path is async now
                 (awaits vlm.predict); a total provider outage is handled
                 without corrupting filter state (see section 6).
  scripts/       demo.sh (curl walkthrough) + gen_dummy_frame.py + print helpers.
                 Backend-local dev/test tooling, distinct from top-level scripts/.

frontend/  React + Vite + Tailwind + Recharts. Layout, chip, chart, insight panel,
           footer, evidence panel, and provider indicator/selector all built —
           see section 8, all done now. Runs against whatever vlm.py returns,
           stub or real, with no frontend-side branching needed either way.

demo/
  clips/         10 validated demo clips. Empty — PLAN.md Phase 4.
  anchors/       4 reference crops (dry/damp/wet/standing water). Empty — Phase 4.
  precomputed/   committed session JSONs for the guaranteed-safe replay path. Empty.
  cache/         dhash -> VLM response cache. Gitignored, regenerable.

scripts/
  extract_frames.py   yt-dlp + ffmpeg helper. Not built yet.
  precompute.py       runs demo clips through the API, writes demo/precomputed/.
                      Not built yet.
```

## 8. Frontend spec

Dark carbon UI, high contrast, large type — **this gets shown on a projector.**

- **Left:** current frame with translucent ROI overlays labelled `ON-LINE` / `OFF-LINE` — done
- **Top right:** large status chip (`DRY` / `DAMP` / `WET` / `DRYING`) on a **signed
  colour axis** — cyan improving, amber/red worsening, grey stable. Never use the same
  colour for "wet and stable" and "wet and worsening"; the derivative is the point. — done
- **Centre right — the trend chart is the hero element, sized accordingly.** Two
  lines (on-line, off-line) plus a shaded confidence band. Dual x-axis: **minutes AND
  laps.** — done
- **Below:** rate readout with arrow, laps-to-crossover, suggestion banner. — done
- **Evidence panel:** show the VLM's raw evidence fields live next to the frame.
  Reviewers need to SEE the AI reasoning, not just its output. — done
  (`EvidencePanel.tsx`, below `FramePanel` in the left column). Shows an honest
  "no VLM evidence — stub mode or provider outage" state rather than fabricating
  something to display when `evidence` is `null`.
- **Footer:** confidence bar, provider indicator, CSV export, **naive-classifier A/B
  toggle**. — confidence bar, CSV export, provider indicator (badge + a `<select>`
  wired to `POST /providers/select`, disabled for any provider with no key) all
  done. The A/B toggle still re-thresholds the same scripted `W` client-side
  rather than calling a genuinely independent `baseline.py` endpoint — that
  part is still PLAN.md Phase 5.
- Desaturate the entire panel when confidence is low. — done
- Optional: Web Speech API TTS through a 300–3000 Hz bandpass for the team-radio
  effect. — not built, optional/stretch.

## 9. Demo mode (critical — this is how we don't lose on stage)

- `scripts/precompute.py` runs all demo clips through the API and writes
  `demo/precomputed/<clip>.json`. **Commit these.** Replay reads cache only — zero
  network, deterministic, instant.
- **LIVE INFERENCE toggle** for single images so a judge can test it for real. One
  call, one image, minimal exposure.
- A folder of **10 validated clips so a judge can pick which one we run.**
- **Naive baseline A/B:** same clip through a single-call 4-class classifier, flickering
  Wet/Damp/Wet/Damp, next to our filtered curve. Show the trap, then show we saw it coming.
- One-command startup. **Must be verified with wifi disabled** — for the *replay*
  path specifically. Live inference is explicitly network-dependent by design; see
  the zero-cost/offline note below for why that split is deliberate, not an oversight.

## 10. Extras beyond the brief

The brief asks for a label, a trend, and a suggestion. Two additions build on
the same data we already collect, without adding new infrastructure or
touching the core render pipeline (section 5):

- **Session summary** (`backend/summary.py`, `GET /session/{id}/summary`): a
  deterministic, race-engineer's-notes recap of the session's label
  transitions — "Opened WET at 0:10. Crossed to DRYING at 3:30 (after 3.3 min
  WET)..." — built by walking the frame history that's already recorded.
  Template strings, same spirit as `decision.py`'s `SUGGESTIONS` dict — **zero
  LLM**, consistent with the zero-cost stack's suggestion-layer rule below.
  Frontend: a "📋 Session Notes" button in the header opens it in a modal.
- **Weather cross-check** (`backend/weather.py`, `GET /session/{id}/weather`):
  wires up the previously-unused Open-Meteo client to compare the VLM-observed
  trend against real rain data — "rain stopped 4 min ago" next to an
  agree/disagree/unknown badge. This also closes a literal brief-compliance
  gap: "basic weather info (optional)" is named in the problem statement but
  wasn't surfaced anywhere until this landed. A session opts in with `lat`/`lon`
  at creation; without them weather is simply unavailable, not an error. The
  agreement heuristic (`decision.weather_agreement`) is deliberately
  conservative — it says "disagree" only when the weather signal is
  unambiguous, "unknown" is a legitimate and common answer, not a failure
  state. Frontend: a badge in the footer, polling every 15s (mostly served
  from `weather.py`'s own cache, not the network).

## 11. Zero-cost stack

No paid APIs, no API keys that require billing, anywhere in this project. Note this
is a narrower claim than "fully offline" — see the offline note below.

- VLM providers: Google AI Studio, Groq, and OpenRouter all have free tiers with no
  billing requirement for the models this project uses. No locally-trained model, so
  no training-compute cost either — nothing to run on Kaggle/Colab, nothing to host.
- Weather: Open-Meteo — keyless, free, no account. `weather.py`'s disk cache keeps it
  off the critical path even when wired in.
- Suggestion strings: template strings (`decision.py`'s `SUGGESTIONS` dict). **No LLM
  in the suggestion-generation step, ever** — the VLM's job is evidence extraction
  (section 4), not writing the suggestion. If a narration/summary model is ever added
  on top of this later, it must run locally via Ollama — never a hosted LLM API for
  that step specifically.
- Deployment target: wherever runs the FastAPI + static frontend for free — no GPU
  dependency at serving time regardless (all inference is a hosted API call, not a
  local model).

**Offline note (reconciles with the old "100% offline" constraint from an earlier
draft of this project):** the **replay path** (precomputed sessions in
`demo/precomputed/`) is 100% offline and must be verified with wifi disabled — that's
section 9's hard requirement. The **live inference path** is explicitly and
unavoidably network-dependent, because a hosted VLM call requires network by
definition. This is a deliberate architecture tradeoff in this version of the
project, not an oversight: we get a real, working "the AI decides" pipeline with zero
training effort, at the cost of live mode needing connectivity. Never write code that
assumes live inference works offline; never write code that makes the replay path
depend on network.

## 12. Non-goals — do not build these, they cost hours and win nothing

No auth, no user accounts, no database (JSON files on disk only), no Docker, no
cloud deploy, **no model training** (see section 3 — this used to be a goal, it
isn't anymore), no automatic road segmentation (two hand-drawn ROI boxes is a
**feature**, framed to judges as "10-second circuit calibration"), no mobile
responsive layout, no test suite beyond a single smoke test on the pipeline.

If you find yourself about to add any of the above, stop and reread this section.

## Environment / tooling

- Python: `venv` + `pip`, one root `backend/requirements.txt` (no separate
  `training/requirements.txt` anymore — there's no training).
- **On this machine, `python`/`python3` on PATH (via git-bash) resolves to an
  MSYS2 UCRT64 build**, whose wheel platform tag has no matching prebuilt
  wheels on PyPI for numpy/opencv — `pip install` for those falls back to a
  source build that fails (tries to bootstrap `cmake` over a broken SSL chain).
  Create the real venv with the standard CPython install instead:
  `py -3.14 -m venv .venv` (PowerShell), then use `.venv\Scripts\pip.exe` /
  `.venv\Scripts\python.exe`. This is what the backend was actually built and
  tested against.
- Frontend: npm, Vite, React, Tailwind, Recharts.
- Secrets: copy `.env.example` to `.env` (gitignored). `main.py` calls
  `load_dotenv()` at startup; `vlm.py` reads `GEMINI_API_KEY`/`GROQ_API_KEY`/
  `OPENROUTER_API_KEY` from the environment on each request.
- No git repo has been initialized for this project (by explicit choice) — do not
  assume `.git` exists or run git commands that require it without checking first.

## Current status

Phase 0 (scaffold) and Phase 1 (pipeline skeleton with a stub decider) are built and
proven end to end via `backend/scripts/demo.sh`. Phase 2 (frontend against the stub)
is fully built and verified in-browser.

Phase 3 is done end to end, backend and frontend: `vlm.py` has a real
ordered-failover provider chain (Gemini → Groq → OpenRouter) over raw REST via
`httpx`, a dhash cache, a token-bucket rate limiter, self-consistency
aggregation, and graceful total-outage handling — verified with a
mocked-provider test harness (22/22 checks) and a full re-run of `demo.sh`
proving zero-key stub-mode behavior is byte-for-byte unchanged. Raw evidence
now flows all the way through to the frontend's evidence panel, and the
footer has a live provider indicator + selector wired to `GET /providers` /
`POST /providers/select`, verified in-browser (correctly shows STUB and
disables all three provider options when no keys are configured).

What's **not** verified: the actual wire format against live Gemini/Groq/
OpenRouter endpoints — that needs your real keys in `.env`, since I don't
handle API keys directly (operating constraint). If a provider's response
shape has drifted from what's documented here, a live call will surface it
fast — try a real photo through `POST /session/{id}/frame` once you've filled
in `.env`. See [PLAN.md](PLAN.md) for full acceptance-criteria detail per
phase; Phase 4 (demo assets: clips, anchors, precompute) is next.
