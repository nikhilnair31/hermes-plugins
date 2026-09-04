"""Immich Photo of the Day — backend routes.

Picks a random image from the local Immich library once per day.
Mounted at /api/plugins/immich-photo-day/ by the Hermes dashboard.

The pick is cached per date, so it stays stable all day. Pass
``?force=1`` to re-pick immediately.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import logging
import os
import random
import urllib.request
from pathlib import Path

from fastapi import APIRouter

log = logging.getLogger(__name__)

router = APIRouter()

IMMICH_BASE = os.environ.get("IMMICH_BASE_URL", "http://localhost:2283")
IMMICH_PUBLIC_BASE = os.environ.get("IMMICH_PUBLIC_URL", "http://100.124.34.102:2283")
STATE_FILE = Path(__file__).resolve().parent.parent / "photo-of-the-day.json"


def _api_key() -> str:
    """Read the Immich API key from env or ~/.hermes/.env."""
    key = os.environ.get("IMMICH_API_KEY", "")
    if key:
        return key
    env_file = Path.home() / ".hermes" / ".env"
    try:
        for line in env_file.read_text().splitlines():
            if line.startswith("IMMICH_API_KEY="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def _immich(path: str, method: str = "GET", body: dict | None = None) -> dict | bytes:
    """Call the Immich API. Returns parsed JSON or raw bytes."""
    url = f"{IMMICH_BASE}{path}"
    headers = {"x-api-key": _api_key()}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read()
        if "json" in resp.headers.get("Content-Type", ""):
            return json.loads(raw)
        return raw


def _thumbnail_data_url(asset_id: str) -> str | None:
    """Fetch the asset thumbnail (WebP) and return it as a data URL."""
    try:
        raw = _immich(f"/api/assets/{asset_id}/thumbnail")
    except Exception as exc:
        log.warning("thumbnail failed for %s: %s", asset_id, exc)
        return None
    if not isinstance(raw, bytes):
        return None
    return "data:image/webp;base64," + base64.b64encode(raw).decode()


def _pick_random_image() -> dict | None:
    """Fetch a batch of random assets and pick one image."""
    assets = _immich("/api/search/random", method="POST", body={"count": 100})
    if not isinstance(assets, list):
        return None
    images = [a for a in assets if a.get("type") == "IMAGE"]
    if not images:
        return None
    asset = random.choice(images)
    thumb = _thumbnail_data_url(asset["id"])
    return {
        "id": asset["id"],
        "fileName": asset.get("originalFileName", ""),
        "dateTime": asset.get("localDateTime") or asset.get("fileCreatedAt") or "",
        "width": asset.get("width"),
        "height": asset.get("height"),
        "thumbDataUrl": thumb,
        "webUrl": f"{IMMICH_PUBLIC_BASE}/photos/{asset['id']}",
    }


def _load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {}


def _save_state(state: dict) -> None:
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2))
    except OSError as exc:
        log.warning("cannot save state: %s", exc)


@router.get("/pick")
async def pick(force: int = 0):
    """Return today's random photo. Cached per day unless force=1."""
    today = dt.date.today().isoformat()
    state = _load_state()
    if not force and state.get("date") == today and state.get("asset"):
        return {"date": today, "asset": state["asset"]}
    asset = _pick_random_image()
    if asset is None:
        return {"date": today, "asset": None, "error": "no images found"}
    _save_state({"date": today, "asset": asset})
    return {"date": today, "asset": asset}
