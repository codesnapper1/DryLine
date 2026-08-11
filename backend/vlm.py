"""VLMProvider chain: ordered failover across hosted vision-language model
providers (Google AI Studio -> Groq -> OpenRouter), used as the per-frame
wetness "sensor." The VLM is treated as a noisy sensor; everything
downstream (temporal.py, decision.py) is deterministic state estimation
over its output.

Falls back automatically to a deterministic sine-plus-noise stub when no
provider API key is configured, so the app always boots and serves sessions
with zero keys set. This is what backend/scripts/demo.sh still exercises,
unchanged, with no keys present.

predict() is the stable entry point main.py calls; its shape doesn't change
between stub and real mode:
    predict(session_id, t, rois, gen_params, single_image) -> {name: {...}}
"""

import asyncio
import base64
import json
import logging
import math
import os
import statistics
import time
import zlib
from pathlib import Path

import cv2
import httpx
import numpy as np

import decision
import prompts
import roi as roi_mod

logger = logging.getLogger(__name__)

# --- stub (used automatically when no provider key is configured) -------

STUB_CONFIDENCE = 0.92


def _seed(session_id: str, roi_name: str, t: float) -> int:
    key = f"{session_id}:{roi_name}:{round(t, 3)}".encode()
    return zlib.crc32(key) & 0xFFFFFFFF


def scripted_w(session_id: str, roi_name: str, t: float, params: dict) -> float:
    # The off-line ROI lags the racing line by lag_s: the track dries on the
    # line first (tire heat + airflow), so its ramp reaches any given wetness
    # level later than the line's. This is what produces the divergence
    # signal decision.py reads for the crossover estimate.
    lag = params.get("lag_s", 0.0) if roi_name == "off_line" else 0.0
    t_eff = max(0.0, t - lag)

    ramp = params["initial_w"] + params["drift_per_min"] * (t_eff / 60.0)
    ripple = params["sine_amp"] * math.sin(2 * math.pi * t_eff / params["sine_period_s"])
    rng = np.random.default_rng(_seed(session_id, roi_name, t))
    noise = float(rng.normal(0.0, params["noise_std"]))

    return float(np.clip(ramp + ripple + noise, 0.0, 1.0))


def _predict_stub(session_id: str, t: float, rois: dict, gen_params: dict) -> dict[str, dict]:
    return {
        name: {
            "w": scripted_w(session_id, name, t, gen_params),
            "confidence": STUB_CONFIDENCE,
            "occluded": False,
            "spread": None,
            "provider": "stub",
            "evidence": None,  # no VLM ran; nothing for an evidence panel to show
        }
        for name in rois
    }


# --- provider chain config ----------------------------------------------

PROVIDER_ORDER = ["gemini", "groq", "openrouter"]

_ENV_KEYS = {"gemini": "GEMINI_API_KEY", "groq": "GROQ_API_KEY", "openrouter": "OPENROUTER_API_KEY"}

# Model IDs drift as providers update their catalogs — check the provider's
# docs if a call starts failing with a "model not found" style error.
GEMINI_MODEL = "gemini-2.5-flash"
GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
OPENROUTER_MODEL = "meta-llama/llama-3.2-11b-vision-instruct:free"

RETRIES_PER_PROVIDER = 2
BACKOFF_BASE_S = 0.75
CALL_TIMEOUT_S = 20.0
RATE_LIMIT_RPM = 20

MIN_MODEL_CONFIDENCE = 0.5
SELF_CONSISTENCY_SPREAD_MAX = 0.15
SELF_CONSISTENCY_SAMPLES = 3

CACHE_DIR = Path(__file__).resolve().parent.parent / "demo" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

_REQUIRED_REGION_FIELDS = {
    "surface_gloss",
    "reflections_visible",
    "standing_water",
    "spray_from_cars",
    "dry_patches_forming",
    "wetness_0_100",
    "confidence_0_100",
}


class ProviderError(Exception):
    pass


class AllProvidersFailedError(Exception):
    pass


# --- runtime state: health, forced-provider override --------------------

_health: dict[str, dict] = {name: {"last_ok": None, "last_error": None} for name in PROVIDER_ORDER}
_forced_provider: str | None = None


def configured_providers() -> list[str]:
    return [n for n in PROVIDER_ORDER if os.environ.get(_ENV_KEYS[n])]


def any_provider_configured() -> bool:
    return len(configured_providers()) > 0


def get_provider_status() -> list[dict]:
    return [
        {
            "name": n,
            "configured": bool(os.environ.get(_ENV_KEYS[n])),
            "forced": n == _forced_provider,
            "last_ok": _health[n]["last_ok"],
            "last_error": _health[n]["last_error"],
        }
        for n in PROVIDER_ORDER
    ]


def select_provider(name: str | None) -> None:
    global _forced_provider
    if name in (None, "auto"):
        _forced_provider = None
        return
    if name not in PROVIDER_ORDER:
        raise ValueError(f"unknown provider {name!r}, expected one of {PROVIDER_ORDER + ['auto']}")
    _forced_provider = name


# --- rate limiter: token bucket per provider, queues rather than errors -

class _TokenBucket:
    def __init__(self, rpm: float):
        self.capacity = rpm
        self.tokens = rpm
        self.rate = rpm / 60.0
        self.updated = time.monotonic()
        self.lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self.lock:
            while True:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                await asyncio.sleep((1 - self.tokens) / self.rate)


_buckets = {name: _TokenBucket(RATE_LIMIT_RPM) for name in PROVIDER_ORDER}


# --- perceptual-hash cache -----------------------------------------------

def _dhash(image_bgr: np.ndarray, hash_size: int = 8) -> str:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
    diff = resized[:, 1:] > resized[:, :-1]
    bits = 0
    for i, v in enumerate(diff.flatten()):
        if v:
            bits |= 1 << i
    return f"{bits:0{hash_size * hash_size // 4}x}"


def _cache_get(key: str) -> dict | None:
    path = CACHE_DIR / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    return None


def _cache_set(key: str, evidence: dict) -> None:
    (CACHE_DIR / f"{key}.json").write_text(json.dumps(evidence, indent=2))


# --- image encoding -------------------------------------------------------

def _encode_b64_jpeg(img_bgr: np.ndarray) -> str:
    ok, buf = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise RuntimeError("failed to encode composite image")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _validate_evidence(ev: dict) -> None:
    for region in ("A", "B"):
        if region not in ev or not isinstance(ev[region], dict):
            raise ProviderError(f"evidence missing region {region!r}")
        missing = _REQUIRED_REGION_FIELDS - ev[region].keys()
        if missing:
            raise ProviderError(f"region {region} missing fields {sorted(missing)}")
    if "occluded_or_unclear" not in ev:
        raise ProviderError("evidence missing occluded_or_unclear")


# --- provider callers: raw REST via httpx, no provider SDKs needed ------

async def _call_gemini(composite_b64: str, anchor_b64s: list[str], api_key: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}"
    parts = [{"text": prompts.USER}]
    for b64 in anchor_b64s:
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": b64}})
    parts.append({"inline_data": {"mime_type": "image/jpeg", "data": composite_b64}})
    body = {
        "system_instruction": {"parts": [{"text": prompts.SYSTEM}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"response_mime_type": "application/json", "temperature": 0.1},
    }
    async with httpx.AsyncClient(timeout=CALL_TIMEOUT_S) as client:
        resp = await client.post(url, json=body)
        resp.raise_for_status()
        data = resp.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as e:
        raise ProviderError(f"unexpected gemini response shape: {e}") from e
    return json.loads(text)


async def _call_openai_compatible(
    base_url: str, api_key: str, model: str, composite_b64: str, anchor_b64s: list[str]
) -> dict:
    content = [{"type": "text", "text": prompts.USER}]
    for b64 in anchor_b64s:
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
    content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{composite_b64}"}})
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": prompts.SYSTEM},
            {"role": "user", "content": content},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(timeout=CALL_TIMEOUT_S) as client:
        resp = await client.post(f"{base_url}/chat/completions", json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise ProviderError(f"unexpected response shape from {base_url}: {e}") from e
    return json.loads(text)


async def _call_groq(composite_b64: str, anchor_b64s: list[str], api_key: str) -> dict:
    return await _call_openai_compatible("https://api.groq.com/openai/v1", api_key, GROQ_MODEL, composite_b64, anchor_b64s)


async def _call_openrouter(composite_b64: str, anchor_b64s: list[str], api_key: str) -> dict:
    return await _call_openai_compatible(
        "https://openrouter.ai/api/v1", api_key, OPENROUTER_MODEL, composite_b64, anchor_b64s
    )


_CALLERS = {"gemini": _call_gemini, "groq": _call_groq, "openrouter": _call_openrouter}


async def _call_chain(composite_b64: str, anchor_b64s: list[str]) -> tuple[dict, str]:
    """Tries providers in order (or just the forced one), retrying each with
    exponential backoff before failing over to the next. Raises
    AllProvidersFailedError only once every configured provider is exhausted.
    """
    order = [_forced_provider] if _forced_provider else PROVIDER_ORDER
    last_err: Exception | None = None
    for name in order:
        api_key = os.environ.get(_ENV_KEYS[name])
        if not api_key:
            continue
        for attempt in range(RETRIES_PER_PROVIDER):
            try:
                await _buckets[name].acquire()
                ev = await _CALLERS[name](composite_b64, anchor_b64s, api_key)
                _validate_evidence(ev)
                _health[name] = {"last_ok": time.time(), "last_error": None}
                return ev, name
            except Exception as e:  # noqa: BLE001 — any failure here means "try next", by design
                last_err = e
                _health[name] = {"last_ok": _health[name]["last_ok"], "last_error": str(e)}
                logger.warning("VLM provider %s attempt %d failed: %s", name, attempt + 1, e)
                if attempt < RETRIES_PER_PROVIDER - 1:
                    await asyncio.sleep(BACKOFF_BASE_S * (2**attempt))
    raise AllProvidersFailedError(str(last_err) if last_err else "no VLM provider is configured")


# --- self-consistency aggregation ----------------------------------------

_REGION_KEY = {"line": "A", "off_line": "B"}


def _aggregate(samples: list[dict]) -> dict[str, dict]:
    """Combines 1-3 raw-evidence samples into one result per ROI. W/confidence
    are the median across samples (self-consistency); the *displayed* evidence
    fields (for the frontend's evidence panel) come from the first sample —
    showing a blended/voted version of categorical fields like "surface_gloss"
    across 3 calls would be misleading, so we show one real reading rather
    than a synthetic composite of three.
    """
    representative = samples[0]["evidence"]
    out = {}
    for roi_name, region_key in _REGION_KEY.items():
        ws = [s[roi_name][0] for s in samples]
        confs = [s[roi_name][1] for s in samples]
        spread = statistics.pstdev(ws) if len(ws) > 1 else None
        out[roi_name] = {
            "w": statistics.median(ws),
            "confidence": statistics.median(confs),
            "occluded": any(s["occluded"] for s in samples),
            "spread": spread,
            "evidence": {
                **representative[region_key],
                "note": representative.get("note", ""),
                "occluded_or_unclear": representative.get("occluded_or_unclear", False),
            },
        }
    return out


async def _predict_real(session_id: str, t: float, rois: dict, single_image: bool) -> dict[str, dict]:
    composite = roi_mod.build_composite(rois)
    composite_b64 = _encode_b64_jpeg(composite)
    anchor_b64s = [base64.b64encode(b).decode("ascii") for b in prompts.load_anchor_bytes()]

    cache_key = _dhash(composite)
    n_samples = SELF_CONSISTENCY_SAMPLES if single_image else 1

    samples: list[dict] = []
    cached = _cache_get(cache_key)
    if cached is not None:
        samples.append(
            {
                "line": decision.evidence_to_w(cached["A"]),
                "off_line": decision.evidence_to_w(cached["B"]),
                "occluded": cached.get("occluded_or_unclear", False),
                "evidence": cached,
            }
        )

    provider_used = "cache"
    while len(samples) < n_samples:
        ev, provider_used = await _call_chain(composite_b64, anchor_b64s)
        if not _cache_get(cache_key):
            _cache_set(cache_key, ev)
        samples.append(
            {
                "line": decision.evidence_to_w(ev["A"]),
                "off_line": decision.evidence_to_w(ev["B"]),
                "occluded": ev.get("occluded_or_unclear", False),
                "evidence": ev,
            }
        )

    result = _aggregate(samples)
    for v in result.values():
        v["provider"] = provider_used
    return result


# --- entry point ----------------------------------------------------------

async def predict(
    session_id: str,
    t: float,
    rois: dict[str, dict],
    gen_params: dict,
    single_image: bool = False,
) -> dict[str, dict]:
    if not any_provider_configured():
        return _predict_stub(session_id, t, rois, gen_params)
    try:
        return await _predict_real(session_id, t, rois, single_image)
    except AllProvidersFailedError as e:
        logger.error("all VLM providers failed: %s", e)
        return {
            name: {
                "w": None,
                "confidence": 0.0,
                "occluded": True,
                "spread": None,
                "provider": "none",
                "evidence": None,
                "error": str(e),
            }
            for name in rois
        }
