# Hermes Plugins

Desktop + dashboard plugins for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) desktop app and dashboard. Each folder is one plugin, installable by copying it into your Hermes home.

## Plugins

### tv-remote
Fire TV remote in the desktop app statusbar: play/pause, volume ±, next track, plus a full pane with stop, mute, prev, back/home and a gated power toggle.

- `desktop/plugin.js` — statusbar chip (segmented pill) + remote pane
- `dashboard/` — Python backend proxying Home Assistant (`media_player` + read-only ADB dumps for accurate playback state)

Requires `HASS_URL` + `HASS_TOKEN` in the dashboard env, and an `androidtv` integration entity (`media_player.fire_tv` by default, override with `FIRETV_ENTITY`). Home Assistant reports `idle` for apps that hide media metadata, so the backend cross-checks playback state via read-only ADB dumps (`dumpsys window` / `dumpsys media_session`) when needed.

### immich-photo-day
Picks a random photo from your local Immich library once per day and shows it in the app. Cached per date; pass `?force=1` to re-pick.

- Requires `IMMICH_API_KEY` in the dashboard env (`IMMICH_BASE_URL` defaults to `http://localhost:2283`).

## Install

1. **Backend (dashboard plugin):** copy the plugin folder to `~/.hermes/plugins/<name>/` and add `<name>` to `plugins.enabled` in `~/.hermes/config.yaml`. Restart the dashboard.
2. **Desktop UI:** copy `desktop/plugin.js` to `<HERMES_HOME>/desktop-plugins/<name>/plugin.js` on the machine running the desktop app, then run **Reload desktop plugins** from the command palette.

`<HERMES_HOME>` is `~/.hermes` by default (`C:\Users\<you>\.hermes` on Windows).

## Structure

Every plugin ships two halves:

```
<name>/
├── dashboard/          # Python FastAPI backend, mounted at /api/plugins/<name>/
│   ├── manifest.json   # name + api entry point
│   └── plugin_api.py   # APIRouter
└── desktop/
    └── plugin.js       # statusbar chips + panes (plain ESM, hot-reloaded)
```

The desktop half talks to its own backend through the plugin SDK's scoped `ctx.rest` door — no raw fetches, no hardcoded credentials.
