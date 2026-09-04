"""Fire TV remote - backend routes for the desktop plugin.

Proxies Home Assistant media_player services for the living-room Fire TV.
Mounted at /api/plugins/tv-remote/ by the Hermes dashboard.

Scope (v2): transport keys (play/pause, stop, volume, mute, next, prev),
Back/Home via ADB keyevents, a power toggle on switch.tv_plug (gated),
and a playback-progress sensor: live position is computed with the
Android playback math (position_at_last_event + speed * elapsed since
`updated`), duration is resolved from the video title via yt-dlp, and
the result is exposed as a percent + label for the desktop UI and for
Home Assistant command_line sensors.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter()

HASS_URL = os.environ.get("HASS_URL", "http://100.124.34.102:8123")
FIRETV_ENTITY = os.environ.get("FIRETV_ENTITY", "media_player.fire_tv")
TV_PLUG_ENTITY = os.environ.get("TV_PLUG_ENTITY", "switch.tv_plug")
ADB_HOST = os.environ.get("FIRETV_ADB_HOST", "192.168.1.186:5555")
YTDLP_BIN = os.environ.get("YTDLP_BIN", "/home/nikhil/.local/bin/yt-dlp")
STATE_FILE = Path(__file__).resolve().parent.parent / "tv-remote-state.json"


def _token() -> str:
    tok = os.environ.get("HASS_TOKEN", "")
    if tok:
        return tok
    env_file = Path.home() / ".hermes" / ".env"
    try:
        for line in env_file.read_text().splitlines():
            if line.startswith("HASS_TOKEN="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def _ha(path: str, payload: dict | None = None, timeout: int = 10) -> tuple[int, Any]:
    """Call HA REST. payload=None -> GET, else POST service call."""
    url = f"{HASS_URL}{path}"
    headers = {"Authorization": f"Bearer {_token()}"}
    if payload is None:
        req = urllib.request.Request(url, headers=headers)
    else:
        headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode(), headers=headers, method="POST"
        )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode() or "{}"
            return resp.status, (json.loads(body) if body else {})
    except Exception as exc:  # noqa: BLE001 - surface to UI, never crash the route
        code = getattr(exc, "code", 0)
        return (code or 0), {"error": str(exc)}


def _media_service(service: str, extra: dict | None = None) -> dict:
    payload = {"entity_id": FIRETV_ENTITY, **(extra or {})}
    status, data = _ha_call_service(service, payload)
    # HA returns a LIST of changed entity states on success, or a dict with
    # {"error": ...} on failure - handle both shapes.
    err = data.get("error") if isinstance(data, dict) else None
    ok = status == 200 and not err
    out: dict = {"ok": ok, "status": status}
    if err:
        out["error"] = str(err)
    return out


def _ha_call_service(service: str, payload: dict) -> tuple[int, Any]:
    return _ha(f"/api/services/media_player/{service}", payload, timeout=15)


def _adb_shell(command: str, timeout: int = 8) -> str:
    """Read-only ADB dump through the server's own adb (no key presses)."""
    try:
        out = subprocess.run(
            ["adb", "-s", ADB_HOST, "shell", command],
            capture_output=True, text=True, timeout=timeout,
        )
        return out.stdout or ""
    except Exception:  # noqa: BLE001 - probing must never raise
        return ""


# --- flags ---------------------------------------------------------------


def _read_flags() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except OSError:
        return {}


def _write_flags(flags: dict) -> None:
    STATE_FILE.write_text(json.dumps(flags))


@router.get("/flags")
async def flags() -> dict:
    f = _read_flags()
    return {"powerAllow": bool(f.get("powerAllow"))}


@router.post("/flags")
async def set_flags(body: dict) -> dict:
    f = _read_flags()
    if isinstance(body.get("power"), bool):
        f["powerAllow"] = body["power"]
    _write_flags(f)
    return {"ok": True, "powerAllow": bool(f.get("powerAllow"))}


# --- state ---------------------------------------------------------------


@router.get("/state")
async def state() -> dict:
    status, data = _ha(f"/api/states/{FIRETV_ENTITY}", timeout=8)
    if status != 200 or not isinstance(data, dict) or "entity_id" not in data:
        return {"ok": False, "offline": True, "status": status}
    attrs = data.get("attributes", {})
    out = {
        "ok": True,
        "state": data.get("state", "unknown"),
        "app": attrs.get("app_name") or attrs.get("app_id") or "",
        "title": attrs.get("media_title") or "",
        "volume": attrs.get("volume_level"),
        "muted": attrs.get("is_volume_muted"),
    }
    # HA lies 'idle' for apps that hide media metadata - cross-check via ADB
    # dumps (read-only) when the integration shows idle/unknown.
    if out["state"] in ("idle", "unknown", "off", "standby"):
        probe = _adb_playback()
        if probe:
            out["state"] = probe["state"] or out["state"]
            out["app"] = probe["app"] or out["app"]
            out["title"] = probe["title"] or out["title"]
            out["via_adb"] = True
    return out


# --- playback progress (ADB dumps + yt-dlp duration) ----------------------

ADB_KEY = {
    # Android KEYCODEs - deterministic on Fire TV (verified in fire-tv-control skill)
    "home": 3,
    "back": 4,
    "vol_up": 24,
    "vol_down": 25,
    "play_pause": 126,  # PLAY
    "pause": 127,  # PAUSE
    "play": 126,
    "stop": 86,
    "next": 87,
    "prev": 88,
    "mute": 164,
}

MEDIA_SERVICES = {
    "play_pause": "media_play_pause",
    "next": "media_next_track",
    "prev": "media_previous_track",
    "stop": "media_stop",
}


class PressBody(BaseModel):
    action: str


_PROG_CACHE: dict = {"at": 0.0, "data": None}
_DUR_CACHE: dict = {}
_PROG_TTL = 4.0  # seconds - the desktop chip polls every 5s


def _parse_time_hms(text: str) -> int | None:
    """'17:29' or '1:02:33' -> seconds."""
    parts = text.strip().split(":")
    if not all(p.isdigit() for p in parts):
        return None
    secs = 0
    for p in parts:
        secs = secs * 60 + int(p)
    return secs


def _resolve_duration(title: str, channel: str) -> int | None:
    """Resolve video duration via yt-dlp title search. Cached per title."""
    if not title:
        return None
    key = f"{title}|{channel}"
    if key in _DUR_CACHE:
        return _DUR_CACHE[key]
    try:
        out = subprocess.run(
            [YTDLP_BIN, "--no-warnings", "--flat-playlist", "--get-duration",
             f"ytsearch1:{title} {channel}".strip()],
            capture_output=True, text=True, timeout=25,
        )
        dur = _parse_time_hms((out.stdout or "").strip().splitlines()[-1]) if out.stdout.strip() else None
    except Exception:  # noqa: BLE001
        dur = None
    _DUR_CACHE[key] = dur if dur else None
    return _DUR_CACHE[key]


def _read_progress() -> dict:
    """One read-only ADB round trip -> live playback percent.

    live position = position_at_last_event + speed * (uptime - updated)
    (Android's own formula; SmartTube updates `position` only on
    pause/seek/play events, so we advance it ourselves).
    """
    up_out = _adb_shell("cat /proc/uptime")
    sess = _adb_shell("dumpsys media_session")
    if not sess:
        return {"ok": False}

    uptime_ms = None
    m = re.search(r"([\d.]+)\s+", up_out)
    if m:
        uptime_ms = int(float(m.group(1)) * 1000)

    app = ""
    mf = re.search(r"mCurrentFocus=Window\{[^\n]*u0\s+([\w.]+)/", _adb_shell("dumpsys window | grep mCurrentFocus"))
    if mf:
        app = mf.group(1)

    # take the ACTIVE session (SmartTube marks itself active=true)
    block = ""
    m = re.search(r"package=org\.smarttube[\s\S]*?(?=\n    \w|\nAudio playback|$)", sess)
    if m:
        block = m.group(0)

    state_code, position, updated, speed = None, None, None, 1.0
    m = re.search(r"state=PlaybackState \{state=(\d+), position=(\d+), buffered position=\d+, speed=([\d.]+), updated=(\d+)", block or sess)
    if m:
        state_code = int(m.group(1))
        position = int(m.group(2))
        speed = float(m.group(3))
        updated = int(m.group(4))

    title = channel = ""
    m = re.search(r"metadata: size=\d+, description=([^,\n]*),\s*([^,\n]*),\s*([^,\n]*)", block or sess)
    if m:
        title = m.group(1).strip()
        channel = m.group(2).strip()
        for bad in ("null", ""):
            if title.lower() == bad:
                title = ""
            if channel.lower() == bad:
                channel = ""

    if state_code is None:
        return {"ok": False}

    playing = state_code == 3
    paused = state_code == 8
    live_ms = position or 0
    if playing and speed and uptime_ms and updated:
        live_ms += int(speed * max(0, uptime_ms - updated))

    dur = _resolve_duration(title, channel)
    percent = None
    if dur:
        percent = max(0.0, min(100.0, live_ms / 1000 / dur * 100))

    return {
        "ok": True,
        "playing": playing,
        "paused": paused,
        "state_code": state_code,
        "app": app,
        "title": title or None,
        "channel": channel or None,
        "position_sec": int(live_ms / 1000),
        "duration_sec": dur,
        "percent": round(percent, 1) if percent is not None else None,
        "remaining_min": round((dur - live_ms / 1000) / 60, 1) if dur else None,
    }


@router.get("/progress")
async def progress() -> dict:
    now = time.time()
    if _PROG_CACHE["data"] and now - _PROG_CACHE["at"] < _PROG_TTL:
        return _PROG_CACHE["data"]
    try:
        out = _read_progress()
    except Exception as exc:  # noqa: BLE001
        out = {"ok": False, "error": str(exc)[:120]}
    _PROG_CACHE.update(at=now, data=out)
    return out


@router.post("/press")
async def press(body: PressBody) -> dict:
    action = body.action

    # Back/Home: real remote keys, sent as ADB keyevents through HA.
    if action in ("back", "home"):
        return _adb_keyevent(ADB_KEY[action])

    # Volume + mute: ADB keyevents (HA's volume_mute service 500s on Fire TV;
    # keycode 164 toggles mute on the TV itself).
    if action in ("vol_up", "vol_down", "mute"):
        return _adb_keyevent(ADB_KEY[action])

    # Transport: HA media services (integration maps them to adb keys itself).
    if action in MEDIA_SERVICES:
        return _media_service(MEDIA_SERVICES[action])

    return {"ok": False, "error": f"unknown action: {action}"}


def _adb_keyevent(keycode: int) -> dict:
    """Send a keyevent via the androidtv integration (read-through response)."""
    status, data = _ha(
        "/api/services/androidtv/adb_command",
        {"entity_id": FIRETV_ENTITY, "command": f"input keyevent {keycode}"},
        timeout=15,
    )
    if status != 200:
        return {"ok": False, "status": status, "error": "adb_command failed (TV awake?)"}
    resp = ""
    if isinstance(data, list) and data:
        resp = str(data[0].get("response", data[0])) if isinstance(data[0], dict) else str(data[0])
    return {"ok": True, "response": resp[:200]}


# --- power (gated) -------------------------------------------------------


class PowerBody(BaseModel):
    action: str


@router.post("/power")
async def power(body: PowerBody) -> dict:
    if not _read_flags().get("powerAllow"):
        return {"ok": False, "error": "power toggle not enabled"}
    if body.action not in ("off", "on"):
        return {"ok": False, "error": "action must be off|on"}
    service = "turn_off" if body.action == "off" else "turn_on"
    status, _ = _ha(
        f"/api/services/switch/{service}", {"entity_id": TV_PLUG_ENTITY}, timeout=10
    )
    return {"ok": status == 200, "action": body.action}
