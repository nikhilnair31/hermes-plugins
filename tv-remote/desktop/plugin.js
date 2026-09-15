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

// Launch-button icons: 64px PNG data URIs (Stremio favicon mark, SmartTube app icon).
const ICON_STREMIO = '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'
const ICON_SMARTTUBE = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAHiUlEQVR4nO2aa4xVVxXHf2vvc859cIdhYKYDnYGRSikgoJJIsZbSUlNoaKgGiqbGxNoPSmJ8tCHxEQXU1C9V09GYpqmWpAk2VDBRmtBCLVSDUtpGUMaBIoWR90znPXPnvPb2w70zCHRkGjlnkM4/2cl9ndy1/uux11p7wxjGMIYxjGEMwpYtGmvlfbG2bNGAXFD+/QsRRMBa4ce/fIRcfhVRoACw1xkxggXAcSOKxS08+nAjIggPPOCx+L7nmFjzafyBUZYyJWSy0Nb6G55tfFB4/OnHqKn9Fr3dIaBGW7Z0IIZChcu5s98TntjUQzaXJ44E5Ppy++FgrUU7lsjvdQCLTdfyAqhy+rkgE9iybDZxAUSwRrCSdZL+r0uhlRAbSxyEYAxD2ioBpcDRaBFimzgNgJhUCVAixEUfN5th0dTJzJs0gUrPpRjFnOwrcqSzm6aOLqIBHzJeChJZSYUAKS8TBDw0dybrFsxh9sTKy8UBmju6eOrvR2n822GsEpJ2hFRiXwmYKOIXSxfxq09+nNkTK4mtxY9jQmOGVhAbZldVsmJ6HTaKUSmUIol7gFYlt1+38MOsnTuT0BgEwVGC1vpdn/nOvoPJJ8IyEiVAiRBHMfVV49mwcC7GWpQIWoTjPX08/sYhDrR3MWAMkxyH1TMbqM3neO30ecRzU0mECRMAJoj47M0fIO84BMbgKsU/OrpYum0nZ7t7QetygrC82HIKN+OBVthUdoGECbAWUMJtk6uxXOi6vvLq65zt7iMzLk9kzEXfhcamWo8lSoCxFrRmcj6HAK5SnOztZ++5NiTrEcTxZbEukFr8Q0q7wOUGHd7CaSoPCROgRCCOOds/gLUQGkPduBwfrZ6A9QNcPfq9V6ISSDm5/eHkufLYoVSGP3nHx6gu5AmKPo5SJaJGCYkSEBuLZFyebf4nJ3v78bQiNIb51VW8umoZi+triYoDmChCKxmVCUyiBFhAKUVncYCHXv4zxlpcpQiMYXbVePasWsbT93yCmRMqiIt+qUtN2RsSD8LYWnTGY9fxk6zZ8Uf6wgivTIK1lofnzODNz6zgp3feyiTPJQ4CtEqPhFSyUGwsOpth6+G3uX3ri+w924pXjn0/NoxzHb7+kVnsX3Mvi+snEw+kR0JqaTg2Fp3L8NfWdu7Y+hJrX9nHv3r7yWiFsZbQGKaPL/DS/XezeOpkYj9MJTmmug/FxqJcl1gpnjzQzILnXqDxQDNKBFeVEmRWazbfcztVuQzWmMQTY+obsSnX+E4uS1sQ8rWX/8L9L+ymJwxxyrmhvpDnS/NuwQZh4qEwapVIZAyiBLeQ43fNb/O5nXuxtjSctBbua7gRtMZcDwOR4WAthLHBKeT4/dEW9p9/B0cpRGBqIU8m42ISDoPRr0UpEaGspaWnf+izjNZ4KnnxUiNgcBAynDWNUtTms0Pve8OQgShOvDVOhQBHBBNGxH4wVO05qrQ8rYj9gPrKAgtqJhJbi7VwqKOL0A/QIol2iIkS4CgBP+CLs25i+8q7WHFTPZWuQ+wHRP0+UdEn6B/ghnyOZ+5aRMF1Sv2DwOa3ToC1ic9GUhmL3za5mhUNdaxoqON0Xz+vn2+nqb2LYhQxvaLAvdPrqM1lCWKDpxVvtnaw7cgJVMYjSngbSJSA2Fi057GkrhaAgSjmxnF5Vk7Ps3J6/UW/HVS+bcDn8zv/RGgMSjskfTCQ/DzAGhoPNNPpB2Sddx+DA3hasf/8O9z92500tXWiXGeoaEpURp7Y1E0mV4GJSOyyiB8wtWo8qz84jTvraplRWUFVxkMrocsPaeroYuvRFn791nGi2KA8B5N0BSQCUeSnQoAWIY5jCKPSpRTPZZzjoJTQH0ZEflBy9YyHEknF8oMEOGkM4GNrUVqjHI21pfe9YTgkiC4fhBpr01F+EBbrIKITP4FkULnSa4GLCpx0jsIvgbUgOAqkHa0tFpPaf1+yUoe1BsexGHPK4eyZH3DzLU8RR2CSzITXDCxKaRxXOH3khwLk2PiT71I37Zu4nmBSc4RRgAWlIQzgVMuPWP/I94Xa+eM4dxC+sHYps+atxnGmYawCe515gliUGCLTQvOhbWz62S5q55fuK1EzJ09rk6FUGGX47wXS4IWPaxFXSisG8AFDzRxFa1P/oCLCjOUe+djBbxle+bCgOPaGDwRXTeSridraHBUVGq2HJyEzzdCvI47uCBjGzYezrgCGb3y7jtr6qfhBjOteBamvElxH8dquQzz/fC+sV7BxOBIu+nxkrrzeKjaK4bGf38qkmu2IVBMnP6wYMawF14Ni/0Hazixjw7pzAIhccZcdYTe4WwGGbO6rFCqq6WwvIuKmVzlcAQIMFCOqb5hPX88aRBpZ/4oDRFd6dGQEfKi1dImju3s7lVUPUhifKx/1/m+CXy2ULmI4dHb00Nm6rxTaG0ZknpFrsGSJw549Dl9+9FNMqV9I4HNNMeBlDIcP7mDzM7tZsgT27Lmi9eG9bWeKKVOynDljys9dExPl/0AMCA0NlhMnfEZYZb9XCyqWL3dxHE2Lf41Yv4xpGcuxYxFNTSGj1GKMYQxjGMMY/t/wb0k8kXuQUSeRAAAAAElFTkSuQmCC'

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

  const appBtnCls =
    'inline-flex h-10 w-full items-center justify-center rounded-lg border border-(--ui-stroke-secondary) ' +
    'bg-(--ui-surface-secondary) text-[0.6875rem] text-(--ui-text-secondary) ' +
    'hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none'

  const launchPress = async (action, name) => {
    haptic('tap')
    try {
      const j = await ctx.rest('/press', { method: 'POST', body: { action }, timeoutMs: 25000 })
      if (j.ok) host.notify({ kind: 'success', message: j.detail || `Opening ${name}` })
      else host.notify({ kind: 'error', message: j.error || 'Launch failed' })
    } catch {
      host.notify({ kind: 'error', message: 'TV backend unreachable' })
    }
  }

  const launchBtn = (label, action, icon) => jsx('button', {
    type: 'button',
    onClick: () => launchPress(action, label),
    title: `Open ${label} on the TV`,
    className: appBtnCls,
    children: jsx('img', {
      src: `data:image/png;base64,${icon}`,
      alt: label,
      draggable: false,
      className: 'h-6 w-6'
    })
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
          btn('⌂', 'home'), powerBtn, launchBtn('Stremio', 'launch_stremio', ICON_STREMIO), launchBtn('SmartTube', 'launch_smarttube', ICON_SMARTTUBE)
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