/**
 * TV Remote - Fire TV controls in the desktop app statusbar.
 * Chip: transport pill + ▾ handle. Click ▾ opens the remote panel as an
 * attached popover (opens upward, right-aligned - the radio-plugin pattern),
 * not a modal dialog. Backend on nitro via ctx.rest.
 */
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  haptic,
  host
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'

const ID = 'tv-remote'

function fmt(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function TvChip({ ctx }) {
  const [open, setOpen] = useState(false)
  const [prog, setProg] = useState(null)

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

  const powerPress = async () => {
    haptic('tap')
    try {
      const j = await ctx.rest('/power', {
        method: 'POST',
        body: { action: 'toggle' },
        timeoutMs: 25000
      })
      if (j.ok) host.notify({ kind: 'success', message: j.detail || 'TV power toggled' })
      else host.notify({ kind: 'error', message: j.error || j.detail || 'TV power failed' })
    } catch {
      host.notify({ kind: 'error', message: 'TV backend unreachable' })
    }
  }

  const stText = prog && prog.ok
    ? (prog.playing ? '▶ Playing' : prog.paused ? '⏸ Paused' : '⏹ Idle')
    : 'TV'

  const btnCls =
    'inline-flex h-10 w-full items-center justify-center rounded-lg border border-(--ui-stroke-secondary) ' +
    'bg-(--ui-surface-secondary) text-base text-(--ui-text-secondary) ' +
    'hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none'

  const btn = (label, action) => jsx('button', {
    type: 'button',
    onClick: () => press(action),
    className: btnCls,
    children: label
  })

  const powerBtn = jsx('button', {
    type: 'button',
    onClick: powerPress,
    title: 'Power on / off',
    className: btnCls,
    children: '⏻'
  })

  const segCls =
    'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
    'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none'

  const progressBlock = prog && prog.ok && (prog.playing || prog.paused) && jsxs('div', {
    className: 'flex flex-col gap-1.5',
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
  })

  const panel = jsxs('div', {
    className: 'flex flex-col gap-3',
    children: [
      jsx('div', {
        className: 'text-sm text-(--ui-text-secondary)',
        children: stText
      }),
      progressBlock,
      jsx('div', {
        className: 'grid grid-cols-4 gap-2',
        children: [
          btn('⏮', 'prev'), btn('⏯', 'play_pause'), btn('⏭', 'next'), btn('⏹', 'stop'),
          btn('−', 'vol_down'), btn('🔇', 'mute'), btn('+', 'vol_up'), btn('↩', 'back'),
          btn('⌂', 'home'), powerBtn, jsx('div', {}), jsx('div', {})
        ]
      }),
      jsx('div', {
        className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
        children: 'Back/Home go through ADB - the TV must be awake.'
      })
    ]
  })

  return jsxs('span', {
    className: 'inline-flex h-full items-center gap-1',
    children: [
      // pill: play/pause + ▾ handle - everything else lives in the panel
      jsx('span', {
        className:
          'inline-flex items-stretch rounded-full border border-(--ui-stroke-tertiary) ' +
          'bg-(--ui-surface-secondary) overflow-hidden shadow-sm',
        children: [
          jsx('button', { type: 'button', className: segCls, onClick: () => press('play_pause'), children: '⏯' }),
          // ▾ handle - opens the remote panel (popover, not a modal)
          jsxs(Popover, {
            open,
            onOpenChange: setOpen,
            children: [
              jsx(PopoverTrigger, {
                asChild: true,
                children: jsx('button', {
                  type: 'button',
                  title: 'More options',
                  className:
                    'inline-flex items-center justify-center min-w-6 px-1.5 text-[0.6875rem] ' +
                    'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground ' +
                    'transition-colors select-none border-l border-(--ui-stroke-tertiary)',
                  children: '▾'
                })
              }),
              jsx(PopoverContent, {
                side: 'top',
                align: 'end',
                'aria-label': 'TV remote',
                children: panel
              })
            ]
          })
        ]
      })
    ]
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