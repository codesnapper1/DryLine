"""Open-Meteo client (keyless, free, no account — CLAUDE.md's zero-cost stack)
disk-cached, always falls back to cache. This is the one permitted network
call in the whole app, and it must never block or error whatever called it —
get_conditions() returns None on total failure (no live data, no cache),
never raises.
"""

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests

CACHE_DIR = Path(__file__).resolve().parent / ".weather_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

CACHE_TTL_S = 15 * 60  # Open-Meteo's own data updates roughly hourly; no need to hit it more often
REQUEST_TIMEOUT_S = 5.0


def _cache_path(lat: float, lon: float) -> Path:
    return CACHE_DIR / f"{round(lat, 3)}_{round(lon, 3)}.json"


def _fetch_live(lat: float, lon: float) -> dict:
    resp = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "current": "precipitation",
            "minutely_15": "precipitation",
            "timezone": "auto",
            "forecast_minutely_15": 4,  # last hour's worth, we only need "when did it last rain"
        },
        timeout=REQUEST_TIMEOUT_S,
    )
    resp.raise_for_status()
    return resp.json()


def _parse(raw: dict) -> dict:
    current = raw.get("current", {})
    precipitation_mm = float(current.get("precipitation") or 0.0)
    is_raining = precipitation_mm > 0.0

    minutes_since_rain: Optional[float] = None
    minutely = raw.get("minutely_15", {})
    times, precips = minutely.get("time", []), minutely.get("precipitation", [])
    now_str = current.get("time")
    if times and precips and now_str:
        now = datetime.fromisoformat(now_str)
        last_rain_at = None
        for t_str, p in zip(times, precips):
            if p and p > 0:
                last_rain_at = datetime.fromisoformat(t_str)
        if last_rain_at is not None:
            minutes_since_rain = max(0.0, (now - last_rain_at).total_seconds() / 60.0)

    return {"precipitation_mm": precipitation_mm, "is_raining": is_raining, "minutes_since_rain": minutes_since_rain}


def get_conditions(lat: float, lon: float) -> Optional[dict]:
    """{"precipitation_mm", "is_raining", "minutes_since_rain", "source":
    "live"|"cache", "fetched_at"} — or None if there's neither a fresh fetch
    nor any cache to fall back to. Never raises.
    """
    path = _cache_path(lat, lon)
    cached_entry = None
    if path.exists():
        try:
            cached_entry = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            cached_entry = None

    if cached_entry is not None and (time.time() - cached_entry["fetched_at"]) < CACHE_TTL_S:
        return {**cached_entry["parsed"], "source": "cache", "fetched_at": cached_entry["fetched_at"]}

    try:
        parsed = _parse(_fetch_live(lat, lon))
        fetched_at = time.time()
        path.write_text(json.dumps({"parsed": parsed, "fetched_at": fetched_at}))
        return {**parsed, "source": "live", "fetched_at": fetched_at}
    except Exception:
        if cached_entry is not None:
            return {**cached_entry["parsed"], "source": "cache", "fetched_at": cached_entry["fetched_at"]}
        return None
