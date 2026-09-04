"""Fire TV remote - backend routes for the desktop plugin.

Proxies Home Assistant media_player services for the living-room Fire TV.
Mounted at /api/plugins/tv-remote/ by the Hermes dashboard.

Scope (v1): transport keys (play/pause, stop, volume, mute, next, prev),
Back/Home via ADB keyevents, and a power toggle on switch.tv_plug that
stays disabled until explicitly enabled in the pane.
"""

from __future__ import annotations

import json
import logging
import os
import re
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


# --- models (all defined before the routes that use them) ----------------


class PressBody(BaseModel):
    action: str


class PowerBody(BaseModel):
    action: str


class AllowBody(BaseModel):
    power: bool | None = None


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


_ADB_HOST = os.environ.get("FIRETV_ADB_HOST", "192.168.1.186:5555")
_STATE_CACHE: dict = {"at": 0.0, "data": None}


def _adb_shell(command: str, timeout: int = 8) -> str:
    """Read-only ADB dump through the server's own adb (no key presses)."""
    import subprocess

    try:
        out = subprocess.run(
            ["adb", "-s", _ADB_HOST, "shell", command],
            capture_output=True, text=True, timeout=timeout,
        )
        return out.stdout or ""
    except Exception:  # noqa: BLE001 - fallback probing must never raise
        return ""


def _adb_playback() -> dict | None:
    """Truth HA can't see: focused app + media session playback state.

    HA's androidtv integration reports 'idle' for apps that hide their
    metadata; dumpsys always knows. Read-only (dumpsys only).
    """
    focus = _adb_shell("dumpsys window | grep mCurrentFocus")
    sess = _adb_shell("dumpsys media_session")
    if not focus and not sess:
        return None

    app = ""
    m = re.search(r"u0\s+([\w.]+)/", focus)
    if m:
        app = m.group(1)

    state, position = "", ""
    m = re.search(r"state=PlaybackState \{state=(\d+)", sess)
    if m:
        code = int(m.group(1))
        state = {0: "stopped", 1: "stopped", 2: "stopped", 3: "playing",
                 4: "stopped", 5: "stopped", 6: "stopped", 7: "stopped",
                 8: "paused", 9: "stopped", 10: "stopped", 11: "stopped"}.get(
                    code, "")
        pm = re.search(r"position=(\d+)", sess)
        if pm:
            position = pm.group(1)

    title = ""
    mt = re.search(r"metadata:.*?description=([^,\n]+)", sess)
    if mt:
        title = mt.group(1).strip()
        if title.lower() in ("null", "none", ""):
            title = ""

    if not state and not app:
        return None
    return {"state": state or "playing" if position else state or "idle",
            "app": app, "title": title}


@router.get("/state")
async def state() -> dict:
    import time as _time

    now = _time.time()
    if _STATE_CACHE["data"] and now - _STATE_CACHE["at"] < 10:
        return _STATE_CACHE["data"]

    status, data = _ha(f"/api/states/{FIRETV_ENTITY}", timeout=8)
    if status != 200 or not isinstance(data, dict) or "entity_id" not in data:
        result = {"ok": False, "offline": True, "status": status}
        _STATE_CACHE.update(at=now, data=result)
        return result
    attrs = data.get("attributes", {})
    st = data.get("state", "unknown")
    out = {
        "ok": True,
        "state": st,
        "app": attrs.get("app_name") or attrs.get("app_id") or "",
        "title": attrs.get("media_title") or "",
        "volume": attrs.get("volume_level"),
        "muted": attrs.get("is_volume_muted"),
    }
    # HA lies 'idle' for apps that hide media metadata - cross-check via ADB
    # dumps (read-only) when the integration shows idle/unknown.
    if st in ("idle", "unknown", "off", "standby"):
        probe = _adb_playback()
        if probe:
            out["state"] = probe["state"] or out["state"]
            out["app"] = probe["app"] or out["app"]
            out["title"] = probe["title"] or out["title"]
            out["via_adb"] = True
    _STATE_CACHE.update(at=now, data=out)
    return out


# --- transport keys (always allowed) -------------------------------------


class PressBody(BaseModel):
    action: str


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


@router.post("/press")
async def press(body: PressBody) -> dict:
    action = body.action

    # Back/Home: real remote keys, sent as ADB keyevents through HA.
    if action in ("back", "home"):
        return _adb_keyevent(ADB_KEY[action])

    # Volume: ADB keyevents (deterministic on this TV).
    if action in ("vol_up", "vol_down", "mute"):
        if action == "mute":
            status, data = _ha(f"/api/states/{FIRETV_ENTITY}", timeout=8)
            if status != 200:
                return {"ok": False, "error": f"HA returned {status}"}
            muted = bool(data.get("attributes", {}).get("is_volume_muted"))
            payload = {"entity_id": FIRETV_ENTITY, "is_volume_muted": not muted}
            s2, d2 = _ha("/api/services/media_player/volume_mute", payload, timeout=10)
            d2err = d2.get("error") if isinstance(d2, dict) else None
            return {"ok": s2 == 200 and not d2err, "muted": not muted,
                    **({"error": str(d2err)} if d2err else {})}
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
