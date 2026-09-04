/**
 * TV Remote — status bar chip with click-to-popout dialog.
 * Same working pattern as immich-photo-day: chip + Dialog pair in one span.
 * Backend: ~/.hermes/plugins/tv-remote/dashboard/plugin_api.py (nitro).
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  haptic,
  host
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'

const ID = 'tv-remote'

function TvChip({ ctx }) {
  const [open, setOpen] = useState(false)
  const [prog, setProg] = useState(null)

  // poll progress only while the dialog is open (5s)
  useEffect(() => {
    if (!open) return
    let dead = false
    const tick = async () => {
      try {
        const d = await ctx.rest('/progress')
        if (!dead) setProg(d)
      } catch { /* keep last */ }
    }
    tick()
    const t = setInterval(tick, 5000)
    return () => { dead = true; clearInterval(t) }
  }, [open, ctx])

  const press = async (action) => {
    haptic('tap')
    try {
      const j = await ctx.rest('/press', { method: 'POST', body: { action } })
      if (!j.ok) host.notify({ kind: 'error', message: j.error || 'TV command failed' })
    } catch {
      host.notify({ kind: 'error', message: 'TV backend unreachable' })
    }
  }

  const btn = (label, action) => jsx('button', {
    type: 'button',
    onClick: () => press(action),
    className:
      'inline-flex h-9 min-w-[52px] items-center justify-center rounded-md border border-(--ui-stroke-secondary) ' +
      'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors',
    children: label
  })

  const row = (...kids) => jsx('div', {
    className: 'flex items-center justify-center gap-2',
    children: kids
  })

  const stText = prog
    ? (prog.playing ? '▶ Playing' : prog.paused ? '⏸ Paused' : '⏹ Idle')
    : 'TV'

  return jsxs('span', {
    className: 'inline-flex h-full items-center',
    children: [
      jsx('span', {
        className:
          'inline-flex items-stretch rounded-full border border-(--ui-stroke-tertiary) ' +
          'bg-(--ui-surface-secondary) overflow-hidden shadow-sm',
        children: [
          jsx('button', {
            type: 'button',
            onClick: () => press('play_pause'),
            className:
              'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
              'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none',
            children: '⏯'
          }),
          jsx('button', {
            type: 'button',
            onClick: () => press('vol_down'),
            className:
              'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
              'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none',
            children: '−'
          }),
          jsx('button', {
            type: 'button',
            onClick: () => press('vol_up'),
            className:
              'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
              'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none',
            children: '+'
          }),
          jsx('button', {
            type: 'button',
            onClick: () => press('next'),
            className:
              'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
              'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none',
            children: '⏭'
          }),
          jsx('button', {
            type: 'button',
            onClick: () => setOpen(true),
            title: 'TV remote - open controls',
            className:
              'inline-flex items-center justify-center min-w-6 px-1.5 text-[0.6875rem] ' +
              'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground ' +
              'transition-colors select-none border-l border-(--ui-stroke-tertiary)',
            children: '▾'
          })
        ]
      }),
      jsx(Dialog, {
        open,
        onOpenChange: setOpen,
        children: jsx(DialogContent, {
          className: 'w-[min(72vw,420px)]',
          children: jsxs('div', {
            className: 'flex flex-col gap-3',
            children: [
              jsx(DialogHeader, {
                children: jsx(DialogTitle, {
                  className: 'text-sm',
                  children: stText
                })
              }),
              prog && prog.ok && (prog.playing || prog.paused) && jsxs('div', {
                className: 'flex flex-col gap-1.5',
                children: [
                  jsxs('div', {
                    className: 'flex items-center justify-between text-xs text-(--ui-text-tertiary)',
                    children: [
                      jsx('span', { className: 'truncate mr-2', children: prog.title || 'playing' }),
                      jsx('span', { children: prog.percent != null ? `${Math.round(prog.percent)}%` : '—' })
                    ]
                  }),
                  jsx('div', {
                    className: 'h-1.5 rounded-full bg-(--ui-surface-secondary) overflow-hidden',
                    children: jsx('div', {
                      className: 'h-full bg-(--ui-accent) transition-all',
                      style: { width: `${prog.percent || 0}%` }
                    })
                  }),
                  jsxs('div', {
                    className: 'text-xs text-(--ui-text-quaternary)',
                    children: [
                      fmt(prog.position_sec),
                      prog.duration_sec ? ` / ${fmt(prog.duration_sec)}` : '',
                      prog.remaining_min != null ? ` · ${Math.round(prog.remaining_min)} min left` : ''
                    ]
                  })
                ]
              }),
              row(
                btn('⏮', 'prev'), btn('⏯', 'play_pause'), btn('⏭', 'next'), btn('⏹', 'stop')
              ),
              row(
                btn('−', 'vol_down'), btn('🔇', 'mute'), btn('+', 'vol_up')
              ),
              row(
                btn('↩ Back', 'back'), btn('⌂ Home', 'home')
              ),
              jsx(DialogDescription, {
                className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
                children: 'Back/Home go through ADB - the TV must be awake.'
              })
            ]
          })
        })
      })
    ]
  })
}

function fmt(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function row(children) {
  return jsx('div', {
    className: 'flex items-center justify-center gap-2',
    children
  })
}

export default {
  id: ID,
  name: 'TV Remote',
  register(ctx) {
    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 150,
      render: () => jsx(TvChip, { ctx })
    })
  }
}