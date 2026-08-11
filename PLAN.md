# DRYLINE — PLAN.md

Phased build order for the hackathon. Read [CLAUDE.md](CLAUDE.md) first — it has
the architecture and constraints this plan implements.

**Architecture note:** this plan replaces an earlier version built around a
locally-trained ordinal-regression model (RSCD dataset, CORN loss, ONNX export).
That work has been deleted — see CLAUDE.md section 3. The current plan is five
phases, moving from a stub decider to a real hosted-VLM provider chain to a
hardened, judge-proof demo.

## Phase 1 — Pipeline skeleton with a stub decider

**Goal:** the entire pipeline — ingest, ROI crop/colour-constancy, temporal
filter, hysteresis, label render, crossover estimate, suggestion string —
provably working end to end, with a scripted stand-in for the VLM.

Status: **mostly done**, carried over from before the architecture pivot (the
pipeline shape didn't change, only what eventually sits behind `vlm.py` did).

Deliverables:
- `backend/roi.py` — real ROI crop + Shades-of-Gray (p=6) + blur/luminance
  confidence-gate checks. ✅ done
- `backend/vlm.py` — STUB. Deterministic sine-plus-noise generator, seeded by
  `(session_id, roi_name, t)`. Renamed from the old `inference.py` — same
  behavior, new name to match where the real provider chain will live. ✅ done
- `backend/temporal.py` — alpha-beta filter + 20s dwell hysteresis. ✅ done
- `backend/decision.py` — thresholds, DRYING render rule, crossover lookup,
  suggestion strings (verbatim organizer phrasing for DRYING). ✅ done
- `backend/store.py` — JSON-file session persistence. ✅ done
- `backend/main.py` — `POST /session`, `POST /session/{id}/frame`,
  `POST /session/{id}/video`, `GET /session/{id}/series`,
  `GET /session/{id}/decision`, `GET /session/{id}/export.csv`. ✅ done
- `backend/main.py` — `GET /providers`, `POST /providers/select`. ✅ done
  (landed alongside Phase 3, listed here since it completes Phase 1's endpoint
  surface).
- `backend/scripts/demo.sh` + `gen_dummy_frame.py`: curl walkthrough of a full
  wet → drying → dry arc, plus a 20s-dwell hysteresis stress test. ✅ done

Acceptance criteria — met (verified live, see `demo.sh`'s output):
- Posting a scripted-drying session produces a displayed label sequence
  WET → DRYING → DRY, DRYING triggered by rate crossing `-0.02/min`.
- The verbatim string *"Track drying: tire change window approaching."*
  appears whenever `displayed_label == "DRYING"`.
- `crossover.eta_laps` shrinks over successive frames while drying, `null`
  once dry or not drying.
- 20s-dwell hysteresis stress test: `raw_label` flaps, `displayed_label`
  changes far less often, never twice within 20 simulated seconds.
- `GET /session/{id}/export.csv` produces a valid CSV, one row per frame.
- Determinism: same session config + same `t` sequence -> identical output.

Phase 1 is now fully closed — no remaining gaps.

## Phase 2 — Frontend against the stub

**Goal:** the full UI per CLAUDE.md section 8, driven by Phase 1's stub.

Status: **done**, built and verified live in-browser.

Deliverables:
- Left: current frame + translucent `ON-LINE`/`OFF-LINE` ROI overlays. ✅ done
- Top right: status chip, signed colour axis (cyan/amber/red/grey). ✅ done
- Centre right: trend chart, hero-sized, two lines + confidence band, dual
  x-axis (minutes + laps). ✅ done
- Below: rate readout, laps-to-crossover, suggestion banner. ✅ done
- Footer: confidence bar, CSV export, provider indicator, naive-classifier
  A/B toggle. ✅ done, with one caveat (see below)
- Evidence panel showing the VLM's raw evidence fields. ✅ done (landed with
  Phase 3, once `vlm.py` had real evidence to show — shows an honest
  "no evidence, stub mode" state otherwise, never fabricates one).
- Provider indicator in the footer. ✅ done — badge + `<select>` wired to
  `POST /providers/select`, disables any provider with no configured key.
- Desaturate panel on low confidence. ✅ done

Acceptance criteria — met:
- Uploading/selecting a frame round-trips through the real backend and shows
  one of the 4 exact labels.
- Trend line visibly updates as frames are processed; auto-play demonstrates
  a full wet→drying→dry arc live in the browser, looping continuously.
- Naive-classifier A/B toggle visibly demonstrates the core thesis (flickering
  per-frame labels vs. the smoothed/hysteresis-gated real pipeline) — **caveat:**
  it currently re-thresholds the same scripted `raw_w_line` client-side rather
  than calling a genuinely independent classifier. Upgrade to call
  `backend/baseline.py` once that exists (Phase 5), for a true apples-to-apples
  single-call-classifier comparison.
- ROI calibration boxes are drawn from `roi_boxes` returned by the session-create
  response, not hardcoded in the frontend.

## Phase 3 — Real VLM

**Goal:** replace `vlm.py`'s scripted stub with the real provider chain, without
touching `temporal.py`, `decision.py`'s render logic, `store.py`, or the public
endpoint contract in `main.py` — Phase 1 proved that boundary holds.

Status: **backend done and verified**; frontend evidence panel/provider
indicator and live-network verification against real keys are the remaining
gaps (see below — the second one structurally can't be done by an agent that
doesn't handle API keys).

Deliverables:
- `backend/prompts.py` — system + user prompt (CLAUDE.md section 4, verbatim),
  `load_anchor_bytes()` reading `demo/anchors/` with graceful degradation
  (works with 0-4 anchors present, warns on what's missing). ✅ done
- `backend/vlm.py` rewritten:
  - `VLMProvider`-style chain, ordered failover: Google AI Studio
    (`gemini-2.5-flash`, JSON schema mode) → Groq (Llama 4 Scout) → OpenRouter
    (`:free` vision model) via raw REST calls (`httpx`, no provider SDKs),
    exponential backoff + retry per provider before failing over. ✅ done
  - Reads keys from `.env` (`main.py` calls `load_dotenv()` at startup); when
    zero keys are configured, `predict()` transparently falls back to the
    original sine-plus-noise stub — **verified**: `demo.sh` re-run byte-for-byte
    unchanged with no `.env` present. ✅ done
  - Composite both ROI crops into one call via `roi.build_composite()`;
    self-consistency (3 samples, median + spread) in single-image mode,
    1 sample for video (`single_image` flag threaded from `main.py`). ✅ done
  - Perceptual-hash (dhash) cache in `demo/cache/` — cache hit = zero API
    calls. ✅ done
  - Token-bucket rate limiter per provider, queues via `asyncio.sleep` rather
    than erroring. ✅ done
  - Total-outage handling: `predict()` never raises to its caller; on every
    provider failing it returns a `provider: "none"` sentinel per ROI that
    `main.py` turns into LOW_CONFIDENCE without corrupting filter state. ✅ done
- `backend/roi.py` — `build_composite()`: stitches line (A) + off_line (B)
  crops side by side with burned-in corner labels. ✅ done
- `backend/decision.py` — `evidence_to_w()`: the `W_ev`/`W` blend formula from
  CLAUDE.md section 4, ahead of the existing (unchanged) `classify_level`/render
  logic. ✅ done
- `backend/main.py` — `_ingest_frame` is now async, passes the full ROI crop
  dict (not just names) to `vlm.predict`, adds VLM-derived confidence-gate
  reasons (`occluded`, `low_model_confidence`, `self_consistency_spread`,
  `no_provider_available`). Real `GET /providers` + `POST /providers/select`
  (force a specific provider — 400 on an unknown name, `"auto"` clears the
  override). ✅ done
- `backend/vlm.py` — raw evidence now threaded all the way through: each
  ROI's result carries an `"evidence"` field (the representative sample's
  categorical fields + note + occluded flag), `None` in stub mode or on total
  outage rather than fabricated. ✅ done
- Frontend: evidence panel (raw VLM fields next to the frame) + provider
  indicator in the footer. ✅ done — `EvidencePanel.tsx`, `Footer.tsx`'s
  provider badge/selector. Verified in-browser against the stub: correctly
  shows the honest "no evidence" state and a STUB badge with all three
  provider options disabled (no keys configured).

Acceptance criteria:
- ~~A real image posted to `/session/{id}/frame` returns evidence-derived `W`
  from an actual provider call~~ — **not independently verifiable by me**: I
  don't hold or enter API keys (operating constraint, not a project one). The
  request/response shapes are built against each provider's documented REST
  contract, but only a run with real keys in `.env` proves the wire format is
  still accurate. **Action for you:** drop your keys into `.env` and run
  `POST /session/{id}/frame` with a real photo once; if a provider's exact
  response shape has drifted, the error will point at which one.
- Failover, retry/backoff, health tracking, forced-provider override, total-
  outage graceful degradation, self-consistency aggregation, dhash cache
  determinism, and the evidence-scoring formula are **verified** via a
  mocked-provider test harness (no network) — 22/22 checks passing, covering:
  gemini+groq failing over to openrouter, forcing a down provider failing
  loud instead of silently falling back, `predict()` never raising even when
  every provider is down, cache hit/miss behavior, and evidence threading
  (stub mode returns `evidence: null`, total outage returns `evidence: null`,
  real mode returns each region's own fields, not a mixed-up A/B swap).
- `occluded_or_unclear: true` or low `confidence_0_100` correctly triggers
  LOW CONFIDENCE (CLAUDE.md section 6) — logic verified, needs a real-provider
  smoke test to confirm actual providers report these fields as expected.
- Killing all 3 provider keys: app still boots, still serves precomputed/cached
  sessions — verified (this is exactly the "zero keys" stub-mode path).
- A repeated image (same dhash) produces zero new API calls — verified via
  the mocked test's cache-hit path.
- A 60-second clip at 0.5fps + composite ROI stays under ~30 API calls — by
  construction (0.5fps × 60s = 30 frames × 1 call each, no self-consistency
  in video mode), not yet measured against a real clip (Phase 4 dependency).
- `demo.sh`'s label-transition assertions still hold in stub mode — verified,
  re-run clean. Real-evidence-driven version needs a real drying-transition
  clip (Phase 4) plus real keys.

## Phase 4 — Demo assets

**Goal:** the clips, anchors, and precomputed sessions the demo actually runs on.

Deliverables:
- `scripts/extract_frames.py` — yt-dlp + ffmpeg helper.
- `demo/anchors/` — 4 reference crops (dry, damp, wet, standing water), cut
  from real footage, used as VLM few-shot anchors on every call.
- `demo/clips/` — 10 validated clips, at least one with a genuine, visible
  wet → drying → dry transition (this is the clip the whole demo narrative
  depends on — find/cut it early in this phase, not at the end).
- `scripts/precompute.py` — runs every clip in `demo/clips/` through the real
  API, writes `demo/precomputed/<clip>.json`.
- `demo/precomputed/*.json` — **committed**, not gitignored (CLAUDE.md Demo Mode).

Acceptance criteria:
- All 4 anchor crops are visually unambiguous examples of their category.
- All 10 clips are validated: each produces a coherent, non-degenerate label
  sequence when run through `precompute.py` (no permanently-LOW-CONFIDENCE
  clips, no clips that never leave one label).
- The drying-transition clip's precomputed trend visibly shows the wet→drying→dry
  arc and triggers the verbatim DRYING suggestion string at the right point.
- Source footage usage rights are checked before anything goes in `demo/clips/`
  or gets shipped in the repo — flag anything uncertain rather than including it.

## Phase 5 — Hardening

**Goal:** ready to demo and to answer judge questions, on venue wifi that may
or may not work.

Deliverables:
- `backend/baseline.py` — real naive single-call 4-class classifier (one VLM
  call, no evidence extraction, no temporal awareness), wired to a comparison
  endpoint/mode.
- Frontend naive-classifier A/B toggle upgraded to call `baseline.py` instead
  of client-side re-thresholding (closes Phase 2's caveat).
- 10-clip judge picker in the UI.
- Live single-image inference toggle, minimal-exposure (one call, one image).
- One-command startup for the whole stack.
- `README.md` compliance table filled in completely and verified against the
  literal brief text, line by line.
- 90-second screen recording of the demo.

### Final acceptance checklist (from the brief)

- [ ] All four labels render, spelled exactly as the brief spells them
- [ ] Trend graph, uploaded image, and condition visible on one screen
- [ ] `"Track drying: tire change window approaching."` appears verbatim
- [ ] Full replay runs with **wifi disabled**
- [ ] Live single-image inference works on a judge-chosen file
- [ ] <40 API calls for a 60-second clip
- [ ] App boots and serves cached sessions with **no API keys set**
- [ ] Label never flips more than once per 20 seconds
- [ ] README maps every problem-statement line to a file and endpoint
