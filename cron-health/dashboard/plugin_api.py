"""Cron Health — backend routes.

Reads the cron job store directly (same source the app uses:
$HERMES_HOME/cron/jobs.json) and reports which jobs are failing,
stale, or paused. Exposes a safe ``run now`` that queues a job on the
next scheduler tick (the same path ``hermes cron run`` uses), never
blocking.

Mounted at /api/plugins/cron-health/ by the Hermes dashboard.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter

log = logging.getLogger(__name__)

router = APIRouter()

STALE_MARGIN_MINUTES = 10  # a job is "late" this far past next_run_at


def _hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def _load_jobs() -> list[dict]:
    p = _hermes_home() / "cron" / "jobs.json"
    try:
        data = json.loads(p.read_text())
    except (OSError, ValueError) as exc:
        log.warning("cannot read jobs.json: %s", exc)
        return []
    jobs = data.get("jobs", data if isinstance(data, list) else [])
    return jobs if isinstance(jobs, list) else []


def _iso_to_utc(ts) -> dt.datetime | None:
    if not ts:
        return None
    if isinstance(ts, (int, float)):
        return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc)
    s = str(ts)
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _summarize_job(job: dict, now: dt.datetime) -> dict:
    last_status = job.get("last_status")
    last_error = job.get("last_error") or job.get("last_delivery_error") or ""
    last_run = _to_utc(job.get("last_run_at"))
    next_run = _to_utc(job.get("next_run_at"))

    paused = bool(job.get("paused_at") or job.get("paused_reason") or job.get("paused"))
    enabled = bool(job.get("enabled", True)) and not paused

    state = "ok"
    reasons = []
    if not enabled:
        state = "paused"
    elif last_status and last_status != "ok":
        state = "failed"
        reasons.append(f"last run {last_status}")
    elif last_error:
        state = "failed"
        reasons.append(last_error[:160])
    elif next_run and next_run < now - dt.timedelta(minutes=STALE_MARGIN_MINUTES):
        state = "stale"
        reasons.append(
            f"missed run (next was {next_run.strftime('%m-%d %H:%M')})"
        )
    elif last_run is None:
        # Enabled job with no recorded run at all: never fired.
        state = "stale"
        reasons.append("never ran")

    sched = job.get("schedule") or {}
    return {
        "id": job.get("id", ""),
        "name": job.get("name", "?"),
        "state": state,
        "reason": " · ".join(reasons) if reasons else "",
        "schedule": sched.get("display") or job.get("schedule_display") or "",
        "lastRun": last_run.strftime("%m-%d %H:%M") if last_run else None,
        "nextRun": next_run.strftime("%m-%d %H:%M") if next_run else None,
        "enabled": enabled,
    }


def _to_utc(ts) -> dt.datetime | None:
    return _iso_to_utc(ts) if not isinstance(ts, dt.datetime) or not ts else ts


def _iso_to_utc(ts) -> dt.datetime | None:
    if not ts:
        return None
    try:
        if isinstance(ts, (int, float)):
            return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc)
        return dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None


@router.get("/status")
async def status():
    now = dt.datetime.now(dt.timezone.utc)
    jobs = [_summarize_job(j, now) for j in _load_jobs()]
    problems = [j for j in jobs if j["state"] in ("failed", "stale")]
    return {
        "asOf": now.strftime("%Y-%m-%d %H:%M"),
        "total": len(jobs),
        "enabled": sum(1 for j in jobs if j["enabled"]),
        "problems": len(problems),
        "failed": sum(1 for j in jobs if j["state"] == "failed"),
        "stale": sum(1 for j in jobs if j["state"] == "stale"),
        "paused": sum(1 for j in jobs if j["state"] == "paused"),
        "jobs": jobs,
    }


@router.post("/run")
async def run(body: dict):
    """Queue a job for the next tick. Safe: never executes inline."""
    job_id = (body or {}).get("id", "")
    if not job_id:
        return {"ok": False, "error": "missing id"}
    try:
        from cron.jobs import trigger_job, AmbiguousJobReference

        job = trigger_job(job_id)
        if not job:
            return {"ok": False, "error": "job not found"}
        return {"ok": True, "id": job_id, "name": job.get("name", "")}
    except AmbiguousJobReference as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:  # backend runs in dashboard process, stay robust
        log.warning("cron-health run failed for %s: %s", job_id, exc)
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}