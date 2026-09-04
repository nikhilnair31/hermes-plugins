/**
 * TV Remote - Fire TV controls in the desktop app statusbar.
 *
 * One chip: transport pill (⏯ − + ⏭). Click the ▾ handle to pop out a
 * floating card with the full remote + playback progress. No separate pane.
 * All calls go through ctx.rest -> the plugin backend -> Home Assistant.
 * Theme vars only; no hardcoded colors.
 */
import { haptic, host } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'

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

// ---- the popout card -----------------------------------------------------

function RemoteCard({ rest, onClose }) {
  const s = usePoll(4000, rest, '/state')
  const p = usePoll(5000, rest, '/progress')
  const [flags, setFlags] = useState({ powerAllow: false })

  useEffect(() => {
    rest('/flags').then(f => setFlags(f)).catch(() => {})
  }, [rest])

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
  const stText = st === 'playing' ? '▶ Playing' : st === 'paused' ? '⏸ Paused' : '⏹ Idle'

  return jsxs('div', {
    className:
      'absolute right-0 top-full mt-1 z-50 w-64 flex flex-col gap-2.5 p-3 text-sm ' +
      'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-card) shadow-lg',
    children: [
      jsx('div', { className: 'text-xs font-medium', children: stText }),

      (p && p.ok && (p.playing || p.paused) && p.percent != null) && jsxs('div', {
        className: 'flex flex-col gap-1',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between text-[0.6875rem] text-(--ui-text-tertiary)',
            children: [
              jsx('span', { className: 'truncate', children: p.title || 'playing' }),
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
            className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
            children:
              `${Math.floor(p.position_sec / 60)}:${String(p.position_sec % 60).padStart(2, '0')}` +
              (p.duration_sec
                ? ` / ${Math.floor(p.duration_sec / 60)}:${String(p.duration_sec % 60).padStart(2, '0')}`
                : '') +
              (p.remaining_min != null ? ` · ${Math.round(p.remaining_min)} min left` : '')
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
          padBtn('↩', () => press('back')),
          padBtn('⌂', () => press('home'))
        ]
      }),

      jsxs('div', {
        className:
          'mt-1 pt-2 border-t border-(--ui-stroke-secondary) text-[0.6875rem] text-(--ui-text-tertiary)',
        children: [
          jsxs('label', {
            className: 'flex items-center gap-2 cursor-pointer',
            children: [
              jsx('input', { type: 'checkbox', checked: !!flags.powerAllow, onChange: togglePowerAllow }),
              'Allow power toggle'
            ]
          }),
          flags.powerAllow && jsx('div', {
            className: 'mt-1.5 flex gap-1.5',
            children: [
              padBtn('⏻ Off', () => doPower('off')),
              padBtn('⏻ On', () => doPower('on'))
            ]
          })
        ]
      })
    ]
  })
}

// ---- the chip ------------------------------------------------------------

function PadChip({ rest }) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const pillRef = useRef(null)
  const act = (action) => () => {
    haptic('tap')
    rest('/press', { method: 'POST', body: { action } }).catch(() => {})
  }

  // close on outside click
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (pillRef.current && !pillRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return jsxs('span', {
    className: 'inline-flex items-center',
    children: [
      jsx('span', {
        ref: pillRef,
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
            onClick: () => {
              haptic('tap')
              const el = pillRef.current
              if (el) setRect(el.getBoundingClientRect())
              setOpen(o => !o)
            },
            children: open ? '▴' : '▾'
          })
        ]
      }),
      open && jsx(RemoteCard, { rest, onClose: () => setOpen(false), rect })
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