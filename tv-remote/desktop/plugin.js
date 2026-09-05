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
      'inline-flex h-10 w-16 items-center justify-center rounded-lg border border-(--ui-stroke-secondary) ' +
      'bg-(--ui-surface-secondary) text-base text-(--ui-text-secondary) ' +
      'hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none',
    children: label
  })

  const row = (...kids) => jsx('div', {
    className: 'grid grid-cols-4 gap-2',
    children: kids
  })

  const rowLabel = (text) => jsx('div', {
    className: 'col-span-4 text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
    children: text
  })

  const group = (...kids) => jsx('div', {
    className: 'flex flex-col gap-2',
    children: kids
  })

  return jsx(Dialog, {
    open,
    onOpenChange: setOpen,
    children: jsx(DialogContent, {
      className: 'w-[min(72vw,380px)]',
      children: jsxs('div', {
        className: 'flex flex-col gap-4',
        children: [
          jsx(DialogHeader, {
            children: jsx(DialogTitle, {
              className: 'text-sm flex items-center justify-between w-full',
              children: jsx('span', { children: stText })
            })
          }),

          (prog && prog.ok && (prog.playing || prog.paused)) && jsxs('div', {
            className: 'flex flex-col gap-1.5 px-0.5',
            children: [
              prog.title ? jsx('div', {
                className: 'truncate text-xs text-(--ui-text-tertiary)',
                children: prog.title
              }) : null,
              jsxs('div', {
                className: 'flex items-center justify-between text-xs text-(--ui-text-tertiary)',
                children: [
                  jsx('span', { children: prog.percent != null ? `${Math.round(prog.percent)}% complete` : 'elapsed' }),
                  jsx('span', { children: prog.remaining_min != null ? `${Math.round(prog.remaining_min)} min left` : '' })
                ]
              }),
              jsx('div', {
                className: 'h-1.5 rounded-full bg-(--ui-surface-secondary) overflow-hidden',
                children: jsx('div', {
                  className: 'h-full bg-(--ui-accent) transition-all',
                  style: { width: `${prog.percent || 0}%` }
                })
              }),
              jsx('div', {
                className: 'text-xs text-(--ui-text-quaternary)',
                children: fmt(prog.position_sec) + (prog.duration_sec ? ` / ${fmt(prog.duration_sec)}` : ' · length unknown')
              })
            ]
          }),

          group(
            row(
              btn('⏮', 'prev'), btn('⏯', 'play_pause'), btn('⏭', 'next'), btn('⏹', 'stop')
            )
          ),

          group(
            rowLabel('tv'),
            row(
              btn('−', 'vol_down'), btn('🔇', 'mute'), btn('+', 'vol_up'), btn('↩', 'back')
            ),
            row(
              btn('⌂', 'home'), jsx('div', { className: 'h-10 w-16' }), jsx('div', { className: 'h-10 w-16' }), jsx('div', { className: 'h-10 w-16' })
            )
          ),

          jsx(DialogDescription, {
            className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
            children: 'Back/Home go through ADB - the TV must be awake.'
          })
        ]
      })
    })
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