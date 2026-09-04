/**
 * TV Remote - Fire TV controls in the desktop app statusbar.
 *
 * One chip: transport pill (⏯ − + ⏭ ▾). Clicking ▾ opens a centered
 * dialog (same pattern as the app's Context Usage popup) with playback
 * progress + the full remote. No separate pane.
 * All calls go through ctx.rest -> the plugin backend -> Home Assistant.
 * Theme vars only; no hardcoded colors.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  haptic,
  host
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'

const ID = 'tv-remote'

async function callRest(rest, path, opts) {
  try {
    return await rest(path, opts)
  } catch {
    host.notify({ kind: 'error', message: 'TV backend unreachable' })
    return { ok: false }
  }
}

function usePoll(ms, rest, path) {
  const [s, setS] = useState(null)
  useEffect(() => {
    let dead = false
    const tick = async () => {
      const d = await callRest(rest, path)
      if (!dead) setS(d)
    }
    tick()
    const t = setInterval(tick, ms)
    return () => { dead = true; clearInterval(t) }
  }, [rest, path, ms])
  return s
}

const BTN =
  'inline-flex items-center justify-center h-9 min-w-11 px-2 rounded-md border border-(--ui-stroke-secondary) ' +
  'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors'

function padBtn(label, fn) {
  return jsx('button', {
    className: BTN + ' text-sm',
    type: 'button',
    onClick: fn,
    children: label
  })
}

function Row({ children }) {
  return jsx('div', {
    className: 'flex items-center justify-center gap-2',
    children
  })
}

function fmt(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function RemoteDialog({ rest, open, onOpenChange }) {
  const s = usePoll(4000, rest, '/state')
  const p = usePoll(5000, rest, '/progress')
  const [flags, setFlags] = useState({ powerAllow: false })

  useEffect(() => {
    if (open) rest('/flags').then(f => setFlags(f)).catch(() => {})
  }, [rest, open])

  const press = useCallback(async (action) => {
    haptic('tap')
    const j = await callRest(rest, '/press', { method: 'POST', body: { action } })
    if (!j.ok) host.notify({ kind: 'error', message: j.error || 'TV command failed' })
  }, [rest])

  const togglePowerAllow = async () => {
    const j = await callRest(rest, '/flags', { method: 'POST', body: { power: !flags.powerAllow } })
    if (j.ok) setFlags({ powerAllow: j.powerAllow })
  }

  const doPower = async (action) => {
    haptic('tap')
    const j = await callRest(rest, '/power', { method: 'POST', body: { action } })
    if (j.ok) host.notify({ kind: 'success', message: `TV plug ${action}` })
    else host.notify({ kind: 'error', message: j.error || 'Power failed' })
  }

  const st = s && !s.offline ? s.state : 'offline'
  const stText = st === 'playing' ? '▶ Playing' : st === 'paused' ? '⏸ Paused' : st === 'offline' ? 'TV offline' : '⏹ Idle'

  return jsxs(Dialog, {
    open,
    onOpenChange,
    children: [
      jsx(DialogHeader, {
        children: jsx(DialogTitle, {
          className: 'text-sm flex items-center justify-between w-full',
          children: jsx('span', { children: stText })
        })
      }),

      (p && p.ok && (p.playing || p.paused) && p.percent != null) && jsxs('div', {
        className: 'flex flex-col gap-1.5 mb-1',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between text-xs text-(--ui-text-tertiary)',
            children: [
              jsx('span', { className: 'truncate mr-2', children: p.title || 'playing' }),
              jsx('span', { children: `${Math.round(p.percent)}%` })
            ]
          }),
          jsx('div', {
            className: 'h-1.5 rounded-full bg-(--ui-surface-secondary) overflow-hidden',
            children: jsx('div', {
              className: 'h-full bg-(--ui-accent) transition-all',
              style: { width: `${p.percent}%` }
            })
          }),
          jsxs('div', {
            className: 'text-xs text-(--ui-text-quaternary)',
            children: [
              fmt(p.position_sec),
              p.duration_sec ? ` / ${fmt(p.duration_sec)}` : '',
              p.remaining_min != null ? ` · ${Math.round(p.remaining_min)} min left` : ''
            ]
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
        className:
          'mt-1 pt-3 border-t border-(--ui-stroke-secondary) text-xs text-(--ui-text-tertiary)',
        children: [
          jsxs('label', {
            className: 'flex items-center gap-2 cursor-pointer',
            children: [
              jsx('input', { type: 'checkbox', checked: !!flags.powerAllow, onChange: togglePowerAllow }),
              'Allow power toggle'
            ]
          }),
          flags.powerAllow && jsx('div', {
            className: 'mt-2 flex gap-2 justify-center',
            children: [
              padBtn('⏻ Off', () => doPower('off')),
              padBtn('⏻ On', () => doPower('on'))
            ]
          })
        ]
      }),

      jsx('div', {
        className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
        children: 'Back/Home/power go through ADB - the TV must be awake.'
      })
    ]
  })
}

function PadChip({ rest }) {
  const [open, setOpen] = useState(false)
  const act = (action) => () => {
    haptic('tap')
    rest('/press', { method: 'POST', body: { action } }).catch(() => {})
  }

  return jsxs('span', {
    className: 'inline-flex items-center',
    children: [
      jsx('span', {
        className:
          'inline-flex items-stretch rounded-full border border-(--ui-stroke-tertiary) ' +
          'bg-(--ui-surface-secondary) overflow-hidden shadow-sm',
        children: [
          seg('⏯', 'play_pause', act),
          seg('−', 'vol_down', act),
          seg('+', 'vol_up', act),
          seg('⏭', 'next', act),
          jsx('button', {
            className:
              'inline-flex items-center justify-center min-w-6 px-1.5 text-[0.6875rem] ' +
              'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground ' +
              'transition-colors select-none border-l border-(--ui-stroke-tertiary)',
            type: 'button',
            title: 'TV remote - open controls',
            onClick: () => { haptic('tap'); setOpen(true) },
            children: '▾'
          })
        ]
      }),
      jsx(RemoteDialog, { rest, open, onOpenChange: setOpen })
    ]
  })
}

function seg(label, action, act) {
  return jsx('button', {
    className:
      'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
      'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground ' +
      'transition-colors select-none',
    type: 'button',
    onClick: act(action),
    children: label
  })
}

export default {
  id: 'tv-remote',
  name: 'TV Remote',
  register(ctx) {
    const rest = ctx.rest
    ctx.register({
      id: 'pad-chip',
      area: 'statusBar.right',
      order: 106,
      render: () => jsx(PadChip, { rest })
    })
  }
}