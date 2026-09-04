/**
 * Immich Photo of the Day — status bar chip with click-to-popout dialog.
 *
 * Backend: ~/.hermes/plugins/immich-photo-day/dashboard/plugin_api.py
 * on the Hermes server (nitro). The chip calls ctx.rest('/pick') which
 * proxies /api/plugins/immich-photo-day/pick — no CORS, no key in the app.
 *
 * Install on the machine running the Hermes desktop app (doom):
 *   <hermes home>/plugins/immich-photo-day/desktop/plugin.js
 * then "Reload desktop plugins" from the command palette (Ctrl+K).
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tip,
  haptic,
  useQuery
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const ID = 'immich-photo-day'

function PhotoChip({ ctx }) {
  // force=1 re-picks immediately; the backend caches per date otherwise.
  const [force, setForce] = useState(0)
  const [open, setOpen] = useState(false)
  const q = useQuery({
    queryKey: [ctx.source, 'photo', force],
    queryFn: () => ctx.rest(force ? '/pick?force=1' : '/pick'),
    staleTime: 30 * 60 * 1000
  })

  const asset = q.data && q.data.asset

  const reroll = () => {
    haptic('tap')
    setForce(f => f + 1)
  }

  const openInImmich = () => {
    if (!asset || !asset.webUrl) return
    // Programmatic anchor click behaves like a real link in Electron.
    const a = document.createElement('a')
    a.href = asset.webUrl
    a.target = '_blank'
    a.rel = 'noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const label = asset
    ? `${asset.fileName || '(unnamed)'} · ${(asset.dateTime || '').slice(0, 10)} — click: view · right-click: open in immich`
    : 'immich photo of the day'

  const chip = jsx('button', {
    type: 'button',
    className: 'inline-flex h-full items-center px-1',
    onClick: () => setOpen(true),
    onContextMenu: e => {
      e.preventDefault()
      openInImmich()
    },
    children: jsxs('span', {
      className:
        'inline-flex h-[20px] max-w-[140px] items-center gap-1 overflow-hidden rounded-full border-(--ui-stroke-secondary) bg-(--ui-canvas-elevated) px-1.5',
      children: [
        asset && asset.thumbDataUrl
          ? jsx('img', {
              src: asset.thumbDataUrl,
              alt: '',
              className: 'block shrink-0 overflow-hidden rounded-full object-cover',
              style: {
                width: 14,
                height: 14,
                borderRadius: 999,
                objectFit: 'cover',
                display: 'block',
                flexShrink: 0
              }
            })
          : jsx('span', {
              className: 'shrink-0 text-[0.6875rem] leading-none text-(--ui-text-tertiary)',
              children: q.isLoading ? '…' : '🖼'
            }),
        jsx('span', {
          className: 'shrink-0 truncate text-[0.6875rem] leading-none text-(--ui-text-tertiary)',
          children:
            asset && asset.dateTime ? asset.dateTime.slice(5, 10).replace('-', '/') : ''
        })
      ]
    })
  })

  return jsxs('span', {
    className: 'inline-flex h-full items-center',
    children: [
      jsx(Tip, { label, children: chip }),
      jsx(Dialog, {
        open,
        onOpenChange: setOpen,
        children: jsx(DialogContent, {
          className: 'w-[min(72vw,640px)]',
          children: jsxs('div', {
            className: 'flex flex-col gap-3',
            children: [
              jsx(DialogHeader, {
                children: jsx(DialogTitle, {
                  className: 'text-sm',
                  children: 'immich photo of the day'
                })
              }),
              asset && asset.dateTime
                ? jsx(DialogDescription, {
                    children: `${asset.fileName || '(unnamed)'} · ${asset.dateTime.slice(0, 10)}`
                  })
                : null,
              jsx('div', {
                className: 'rounded-md bg-(--ui-canvas-elevated)',
                children:
                  asset && asset.thumbDataUrl
                    ? jsx('img', {
                        src: asset.thumbDataUrl,
                        alt: asset.fileName || 'immich photo',
                        className: 'max-h-[60vh] w-full object-contain'
                      })
                    : jsx('div', {
                        className: 'flex h-40 items-center justify-center text-xs text-(--ui-text-quaternary)',
                        children: q.isLoading ? 'loading…' : 'no photo'
                      })
              }),
              jsx(DialogFooter, {
                children: jsxs('div', {
                  className: 'flex items-center gap-1.5',
                  children: [
                    jsx(Button, {
                      variant: 'secondary',
                      size: 'sm',
                      onClick: reroll,
                      children: 'reroll'
                    }),
                    asset && asset.webUrl
                      ? jsx(Button, {
                          variant: 'ghost',
                          size: 'sm',
                          onClick: openInImmich,
                          className: 'ml-auto text-(--ui-accent)',
                          children: 'open in immich'
                        })
                      : null
                  ]
                })
              })
            ]
          })
        })
      })
    ]
  })
}

export default {
  id: ID,
  name: 'Immich Photo of the Day',
  defaultEnabled: true,
  register(ctx) {
    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 150,
      render: () => jsx(PhotoChip, { ctx })
    })
  }
}