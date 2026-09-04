"""Fire TV playback progress for HA - pure-python ADB (no adb binary)."""
import json
import re
import subprocess
import asyncio

ADB_HOST = "192.168.1.186:5555"
HOST, PORT = ADB_HOST.split(":")
YTDLP = "/usr/local/bin/yt-dlp"
_DUR_CACHE = {}


def parse_hms(t):
    parts = t.strip().split(":")
    if not all(p.isdigit() for p in parts):
        return None
    s = 0
    for p in parts:
        s = s * 60 + int(p)
    return s


def ytdlp_duration(title, channel):
    if not title:
        return None
    key = f"{title}|{channel}"
    if key in _DUR_CACHE:
        return _DUR_CACHE[key]
    try:
        out = subprocess.run(
            [YTDLP, "--no-warnings", "--flat-playlist", "--get-duration",
             f"ytsearch1:{title} {channel}".strip()],
            capture_output=True, text=True, timeout=25)
        dur = parse_hms(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else None
    except Exception:
        dur = None
    _DUR_CACHE[key] = dur
    return dur


async def fetch():
    from androidtv.adb_manager.adb_manager_async import AdbDeviceTcpAsync
    dev = AdbDeviceTcpAsync(HOST, int(PORT), 'androidtv_adbkey', False)
    try:
        await dev.connect(log_commands=False, auth_timeout_s=5.0)
        up, sess = await asyncio.gather(
            dev.shell("cat /proc/uptime"),
            dev.shell("dumpsys media_session"),
        )
    finally:
        try:
            await dev.close()
        except Exception:
            pass

    uptime_ms = None
    m = re.search(r"([\d.]+)\s+", up or "")
    if m:
        uptime_ms = int(float(m.group(1)) * 1000)

    block = sess or ""
    bm = re.search(r"package=org\.smarttube[\s\S]*?(?=\n    \w|\nAudio playback|$)", sess)
    if bm:
        block = bm.group(0)

    st = re.search(r"state=PlaybackState \{state=(\d+), position=(\d+), buffered position=\d+, speed=([\d.]+), updated=(\d+)", block)
    if not st:
        return {"playing": False, "paused": False, "app": None}

    code, pos, speed, updated = int(st.group(1)), int(st.group(2)), float(st.group(3)), int(st.group(4))

    md = re.search(r"metadata: size=\d+, description=([^,\n]*),\s*([^,\n]*),\s*([^,\n]*)", block)
    title = channel = ""
    if md:
        title = md.group(1).strip()
        channel = md.group(2).strip()
        title = "" if title.lower() in ("null", "") else title
        channel = "" if channel.lower() in ("null", "") else channel

    live_ms = pos
    if code == 3 and speed and uptime_ms:
        live_ms += int(speed * max(0, uptime_ms - updated))

    dur = ytdlp_duration(title, channel)
    pct = round(min(100.0, live_ms / 1000 / dur * 100), 1) if dur else None

    return {
        "playing": code == 3,
        "paused": code == 8,
        "app": "SmartTube" if "smarttube" in (block or "").lower() else None,
        "title": title or None,
        "channel": channel or None,
        "position_sec": int(live_ms / 1000),
        "duration_sec": dur,
        "percent": pct,
        "remaining_min": round((dur - live_ms / 1000) / 60, 1) if dur else None,
    }


def main():
    try:
        data = asyncio.run(fetch())
    except Exception as e:
        data = {"playing": False, "error": str(e)[:120]}
    print(json.dumps(data))


main()
