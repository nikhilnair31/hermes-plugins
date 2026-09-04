/**
 * TV Remote - Fire TV controls in the desktop app.
 *
 * Statusbar: now-playing chip (click = play/pause) + a transport chip.
 * Pane: full remote (transport, volume, mute, next/prev, back/home,
 * gated power toggle).
 *
 * All calls go through ctx.rest -> the plugin's own backend namespace
 * (/api/plugins/tv-remote) -> Home Assistant. Auth is handled by the app's
 * REST door - no raw fetch, no hardcoded colors (theme vars only).
 */
import { haptic, host } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'

const ID = 'tv-remote'

function StatusLine({ s }) {
  if (!s || s.offline) return 'TV offline'
  const st = s.state || 'unknown'
  const icon = st === 'playing' ? '▶' : st === 'paused' ? '⏸' : '⏹'
  const label = s.title || st
  return jsxs('span', {
    className: 'flex items-center gap-1 min-w-0',
    children: [
      jsx('span', { 'aria-hidden': true, children: icon }),
      jsx('span', { className: 'truncate max-w-[160px]', children: label })
    ]
  })
}

const BTN =
  'inline-flex items-center justify-center h-8 min-w-9 px-2 rounded-md border border-(--ui-stroke-secondary) ' +
  'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors'

function padBtn(label, fn) {
  return jsx('button', {
    className: BTN + ' text-xs',
    type: 'button',
    onClick: fn,
    children: label
  })
}

function Row({ children }) {
  return jsx('div', {
    className: 'flex items-center justify-center gap-1.5',
    children
  })
}

function usePluginState(rest, ms) {
  const [s, setS] = useState(null)
  useEffect(() => {
    let dead = false
    const tick = async () => {
      try {
        const d = await rest('/state')
        if (!dead) setS(d)
      } catch {
        if (!dead) setS({ ok: false, offline: true })
      }
    }
    tick()
    const t = setInterval(tick, ms)
    return () => { dead = true; clearInterval(t) }
  }, [rest, ms])
  return s
}

function PadChip({ rest }) {
  const act = (action) => () => {
    haptic('tap')
    rest('/press', { method: 'POST', body: { action } }).catch(() => {})
  }
  return jsxs('span', {
    className: 'inline-flex items-center gap-1 px-1.5 h-full',
    children: [
      jsx('span', {
        className:
          'inline-flex items-stretch rounded-full border border-(--ui-stroke-tertiary) ' +
          'bg-(--ui-surface-secondary) overflow-hidden shadow-sm',
        children: [
          seg('⏯', 'play_pause', act),
          seg('−', 'vol_down', act),
          seg('+', 'vol_up', act),
          seg('⏭', 'next', act)
        ]
      })
    ]
  })
}

function seg(label, action, act) {
  return jsx('button', {
    className:
      'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
      'text-(--ui-text-secondary) rounded-full hover:bg-(--chrome-action-hover) hover:text-foreground ' +
      'transition-colors select-none',
    type: 'button',
    onClick: act(action),
    children: label
  })
}

function useProgress(rest, ms) {
  const [p, setP] = useState(null)
  useEffect(() => {
    let dead = false
    const tick = async () => {
      try {
        const d = await rest('/progress')
        if (!dead) setP(d)
      } catch {
        if (!dead) setP({ ok: false })
      }
    }
    tick()
    const t = setInterval(tick, ms)
    return () => { dead = true; clearInterval(t) }
  }, [rest, ms])
  return p
}

function RemotePane({ rest }) {
  const s = usePluginState(rest, 4000)
  const p = useProgress(rest, 5000)
  const [flags, setFlags] = useState({ powerAllow: false })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    rest('/flags').then(f => setFlags(f)).catch(() => {})
  }, [rest])

  const press = useCallback(async (action) => {
    haptic('tap')
    try {
      const j = await rest('/press', { method: 'POST', body: { action } })
      if (!j.ok) host.notify({ kind: 'error', message: j.error || 'TV command failed' })
    } catch {
      host.notify({ kind: 'error', message: 'TV backend unreachable' })
    }
  }, [rest])

  const togglePowerAllow = async () => {
    const j = await rest('/flags', { method: 'POST', body: { power: !flags.powerAllow } })
    if (j.ok) setFlags({ powerAllow: j.powerAllow })
  }

  const doPower = async (action) => {
    haptic('tap')
    try {
      const j = await rest('/power', { method: 'POST', body: { action } })
      if (j.ok) host.notify({ kind: 'success', message: `TV plug ${action}` })
      else host.notify({ kind: 'error', message: j.error || 'Power failed' })
    } catch {
      host.notify({ kind: 'error', message: 'TV backend unreachable' })
    }
  }

  return jsxs('div', {
    className: 'flex h-full flex-col gap-3 p-3 text-sm overflow-y-auto',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsx('div', { className: 'font-medium', children: 'TV Remote' }),
          jsx('div', {
            className: 'text-(--ui-text-tertiary) text-xs',
            children: jsx(StatusLine, { s })
          })
        ]
      }),

      jsx(Row, {
        children: [
          padBtn('⏮', () => press('prev')),
          padBtn('⏯', () => press('play_pause')),
          padBtn('⏭', () => press('next')),
          padBtn('⏹', () => press('stop'))
        ]
      }),

      jsx(Row, {
        children: [
          padBtn('−', () => press('vol_down')),
          padBtn('🔇', () => press('mute')),
          padBtn('+', () => press('vol_up'))
        ]
      }),

      jsx(Row, {
        children: [
          padBtn('↩ Back', () => press('back')),
          padBtn('⌂ Home', () => press('home'))
        ]
      }),

      jsxs('div', {
        className: 'text-xs text-(--ui-text-tertiary)',
        children: [
          'Volume ',
          s && s.volume != null ? `${Math.round(s.volume * 100)}%` : '—',
          s && s.muted ? ' (muted)' : '',
          s && s.app ? ` · ${s.app}` : ''
        ]
      }),

      (p && p.ok && p.percent != null)
        ? jsxs('div', {
            className: 'flex flex-col gap-1',
            children: [
              jsxs('div', {
                className: 'flex items-center justify-between text-xs text-(--ui-text-tertiary)',
                children: [
                  jsx('span', { className: 'truncate max-w-[150px]', children: p.title || 'playing' }),
                  jsx('span', { children: `${Math.round(p.percent)}%` })
                ]
              }),
              jsx('div', {
                className: 'h-1 rounded-full bg-(--ui-surface-secondary) overflow-hidden',
                children: jsx('div', {
                  className: 'h-full bg-(--ui-accent) transition-all',
                  style: { width: `${p.percent}%` }
                })
              }),
              jsx('div', {
                className: 'text-xs text-(--ui-text-quaternary)',
                children: `${Math.floor(p.position_sec / 60)}:${String(p.position_sec % 60).padStart(2, '0')} / ${p.duration_sec ? `${Math.floor(p.duration_sec / 60)}:${String(p.duration_sec % 60).padStart(2, '0')}` : '—'} · ${p.remaining_min != null ? `${Math.round(p.remaining_min)} min left` : ''}`
              })
            ]
          })
        : null,

      jsxs('div', {
        className:
          'mt-2 pt-2 border-t border-(--ui-stroke-secondary) text-xs text-(--ui-text-tertiary)',
        children: [
          jsxs('label', {
            className: 'flex items-center gap-2 cursor-pointer',
            children: [
              jsx('input', {
                type: 'checkbox',
                checked: !!flags.powerAllow,
                onChange: togglePowerAllow
              }),
              'Allow power toggle'
            ]
          }),
          jsx('div', {
            className: 'mt-1.5 flex gap-1.5',
            children: [
              padBtn('⏻ Off', () => doPower('off')),
              padBtn('⏻ On', () => doPower('on'))
            ]
          })
        ]
      }),

      jsx('div', {
        className: 'text-xs text-(--ui-text-quaternary)',
        children: 'Back/Home go through ADB - the TV must be awake.'
      })
    ]
  })
}

export default {
  id: ID,
  name: 'TV Remote',
  register(ctx) {
    const rest = ctx.rest
    ctx.register({
      id: 'pad-chip',
      area: 'statusBar.right',
      order: 106,
      render: () => jsx(PadChip, { rest })
    })
    ctx.register({
      id: 'remote-pane',
      area: 'panes',
      title: 'tv remote',
      data: { placement: 'right', width: '237px' },
      render: () => jsx(RemotePane, { rest })
    })
  }
}