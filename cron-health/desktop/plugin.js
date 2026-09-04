/**
 * Cron Health — status bar chip.
 *
 * Backend: ~/.hermes/plugins/cron-health/dashboard/plugin_api.py on the
 * Hermes server. Reads jobs.json (the app's own source of truth), flags
 * failed / stale / paused jobs. This chip stays quiet when healthy, shows
 * a red badge when jobs fail.
 *
 * Install on the machine running the Hermes desktop app (doom):
 *   <hermes home>/plugins/cron-health/desktop/plugin.js
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
  host,
  useMutation,
  useQuery,
  useQueryClient
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const ID = 'cron-health'

function CronChip({ ctx }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const q = useQuery({
    queryKey: [ctx.source, 'status'],
    queryFn: () => ctx.rest('/status'),
    refetchInterval: 5 * 60 * 1000, // quiet background refresh
    staleTime: 60 * 1000
  })

  const runMutation = useMutation({
    mutationFn: id => ctx.rest('/run', { method: 'POST', body: { id } }),
    onSuccess: res => {
      if (res && res.ok === false) {
        host.notify({ kind: 'error', message: `cron run failed: ${res.error}` })
      }
    },
    onError: e => {
      host.notify({ kind: 'error', message: `cron run error: ${e && e.message}` })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [ctx.source, 'status'] })
    }
  })

  const data = q.data
  const problems = (data && data.problems) || 0
  const stale = (data && data.stale) || 0

  const label = problems > 0
    ? `${problems} cron job${problems === 1 ? '' : 's'} need attention` +
      (stale > 0 ? ` (${stale} stale)` : '')
    : 'cron healthy'

  const chip = jsx('button', {
    type: 'button',
    className: 'inline-flex h-full items-center px-1',
    onClick: () => setOpen(true),
    children: jsxs('span', {
      className:
        'inline-flex h-[20px] items-center gap-1 overflow-hidden rounded-full border px-1.5 text-[0.6875rem] leading-none ' +
        (problems > 0
          ? 'border-(--ui-danger-border) bg-(--ui-danger-background) text-(--ui-danger)'
          : 'border-(--ui-stroke-secondary) bg-(--ui-canvas-elevated) text-(--ui-text-tertiary)'),
      children: [
        jsx('span', { children: problems > 0 ? '⚠' : '✓' }),
        jsx('span', { children: problems > 0 ? String(problems) : 'cron' })
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
          className: 'w-[min(80vw,560px)]',
          children: jsxs('div', {
            className: 'flex flex-col gap-3',
            children: [
              jsx(DialogHeader, {
                children: jsx(DialogTitle, {
                  className: 'text-sm',
                  children: 'cron jobs'
                })
              }),
              data
                ? jsx(DialogDescription, {
                    children: `${data.enabled} enabled · ${data.problems} problems · ${data.paused} paused · as of ${data.asOf}`
                  })
                : null,
              jsx('div', {
                className: 'flex max-h-[45vh] flex-col gap-1 overflow-y-auto pr-1',
                children: !data
                  ? jsx('div', {
                      className: 'py-6 text-center text-xs text-(--ui-text-quaternary)',
                      children: q.isLoading ? 'loading…' : 'no data'
                    })
                  : jsxs('div', {
                      className: 'flex flex-col gap-1',
                      children: data.jobs.map(job =>
                        jsxs(
                          'div',
                          {
                            className:
                              'flex items-center gap-2 rounded-md px-2 py-1.5 ' +
                              (job.state === 'failed' || job.state === 'stale'
                                ? 'bg-(--ui-danger-background)'
                                : ''),
                            children: [
                              jsx('span', {
                                className: 'w-4 shrink-0 text-center',
                                children:
                                  job.state === 'ok'
                                    ? '✓'
                                    : job.state === 'paused'
                                      ? '⏸'
                                      : '⚠'
                              }),
                              jsx('div', {
                                className: 'min-w-0 flex-1',
                                children: jsxs('div', {
                                  className: 'flex flex-col',
                                  children: [
                                    jsx('span', {
                                      className: 'truncate text-xs font-medium',
                                      children: job.name
                                    }),
                                    jsx('span', {
                                      className:
                                        'truncate text-[0.6875rem] text-(--ui-text-quaternary)',
                                      children:
                                        (job.schedule ? `${job.schedule} · ` : '') +
                                        (job.lastRun ? `last ${job.lastRun}` : 'never') +
                                        (job.reason ? ` · ${job.reason}` : '')
                                    })
                                  ]
                                })
                              }),
                              job.enabled
                                ? jsx(Button, {
                                    variant: 'ghost',
                                    size: 'sm',
                                    onClick: () => {
                                      haptic('tap')
                                      runMutation.mutate(job.id)
                                    },
                                    children: 'run'
                                  })
                                : null
                            ]
                          },
                          job.id
                        )
                      )
                    })
                }),
              jsx(DialogFooter, {
                children: jsx('div', {
                  className: 'flex items-center justify-end gap-1.5',
                  children: jsx(Button, {
                    variant: 'secondary',
                    size: 'sm',
                    onClick: () => setOpen(false),
                    children: 'close'
                  })
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
  name: 'Cron Health',
  defaultEnabled: true,
  register(ctx) {
    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 160,
      render: () => jsx(CronChip, { ctx })
    })
  }
}