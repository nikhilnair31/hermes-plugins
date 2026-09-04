/**
 * TV Remote - Fire TV controls in the desktop app statusbar.
 *
 * Chip: transport pill (⏯ - + ⏭ ▾). The ▾ handle opens an imperative DOM
 * popout appended to document.body (escapes statusbar clipping), styled
 * with theme vars. Progress polls the plugin backend every 5s while open.
 */
import { haptic, host } from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

const BASE = '/api/plugins/tv-remote'

async function api(path, opts) {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  return res.json()
}

async function press(action) {
  haptic('tap')
  try {
    const j = await api('/press', { method: 'POST', body: JSON.stringify({ action }) })
    if (!j.ok) host.notify({ kind: 'error', message: j.error || 'TV command failed' })
  } catch {
    host.notify({ kind: 'error', message: 'TV backend unreachable' })
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

function buildPopout(rest, close) {
  const card = el('div')
  card.style.cssText = [
    'position:fixed', 'z-index:99999', 'width:280px', 'padding:14px',
    'display:flex', 'flex-direction:column', 'gap:10px', 'font-size:13px',
    'border-radius:10px', 'border:1px solid var(--ui-stroke-secondary)',
    'background:var(--ui-canvas-elevated,var(--ui-card,#1b1717))',
    'color:var(--ui-text-secondary)', 'box-shadow:0 8px 28px rgba(0,0,0,.45)'
  ].join(';')

  const stateLine = el('div', null, 'TV …')
  stateLine.style.cssText = 'font-weight:500'

  const prog = el('div')
  prog.style.cssText = 'display:none;flex-direction:column;gap:6px'
  const progTop = el('div')
  progTop.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:var(--ui-text-tertiary)'
  const progTitle = el('span'); progTitle.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px'
  const progPct = el('span')
  progTop.append(progTitle, progPct)
  const barOuter = el('div')
  barOuter.style.cssText = 'height:6px;border-radius:99px;background:var(--ui-surface-secondary);overflow:hidden'
  const barInner = el('div')
  barInner.style.cssText = 'height:100%;background:var(--ui-accent);width:0%;transition:width .4s'
  barOuter.append(barInner)
  const progSub = el('div')
  progSub.style.cssText = 'font-size:11px;color:var(--ui-text-quaternary)'
  prog.append(progTop, barOuter, progSub)

  const mkBtn = (label, action) => {
    const b = el('button', null, label)
    b.style.cssText = [
      'height:34px','min-width:44px','padding:0 10px','border-radius:8px',
      'border:1px solid var(--ui-stroke-secondary)','background:transparent',
      'color:var(--ui-text-secondary)','cursor:pointer','font-size:13px'
    ].join(';')
    b.onmouseenter = () => { b.style.background = 'var(--chrome-action-hover)' }
    b.onmouseleave = () => { b.style.background = 'transparent' }
    b.onclick = () => { haptic('tap'); press(action) }
    return b
  }
  const row = (...btns) => {
    const r = el('div')
    r.style.cssText = 'display:flex;gap:8px;justify-content:center'
    btns.forEach(b => r.append(b))
    return r
  }

  const powerWrap = el('div')
  powerWrap.style.cssText = 'display:none;flex-direction:column;gap:8px;border-top:1px solid var(--ui-stroke-secondary);padding-top:10px'
  const powerLabel = el('label', null, 'Allow power toggle')
  powerLabel.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:11px;color:var(--ui-text-tertiary);cursor:pointer'
  const powerCheck = el('input'); powerCheck.type = 'checkbox'
  powerCheck.onchange = async () => {
    await api('/flags', { method: 'POST', body: JSON.stringify({ power: powerCheck.checked }) })
    row2.style.display = powerCheck.checked ? 'flex' : 'none'
  }
  powerLabel.append(powerCheck)
  const row2 = el('div')
  row2.style.cssText = 'display:none;gap:8px;justify-content:center'
  const off = mkBtn('⏻ Off'); off.onclick = async () => { haptic('tap'); await api('/power', { method: 'POST', body: JSON.stringify({ action: 'off' }) }) }
  const on = mkBtn('⏻ On'); on.onclick = async () => { haptic('tap'); await api('/power', { method: 'POST', body: JSON.stringify({ action: 'on' }) }) }
  row2.append(off, on)
  powerWrap.append(powerLabel, row2)

  const footer = el('div', null, 'Back/Home/power go through ADB - the TV must be awake.')
  footer.style.cssText = 'font-size:10px;color:var(--ui-text-quaternary)'

  const btnRow1 = row(mkBtn('⏮', 'prev'), mkBtn('⏯', 'play_pause'), mkBtn('⏭', 'next'), mkBtn('⏹', 'stop'))
  const btnRow2 = row(mkBtn('−', 'vol_down'), mkBtn('🔇', 'mute'), mkBtn('+', 'vol_up'))
  const btnRow3 = row(mkBtn('↩ Back', 'back'), mkBtn('⌂ Home', 'home'))

  card.append(stateLine, prog, btnRow1, btnRow2, btnRow3, powerWrap, footer)

  let alive = true
  const tick = async () => {
    if (!alive) return
    try {
      const p = await api('/progress')
      if (p && p.ok) {
        stateLine.textContent = p.playing ? '▶ Playing' : p.paused ? '⏸ Paused' : '⏹ Idle'
        if (p.title) { progTitle.textContent = p.title }
        if (p.percent != null) {
          prog.style.display = 'flex'
          progPct.textContent = `${Math.round(p.percent)}%`
          barInner.style.width = `${p.percent}%`
          progSub.textContent = `${fmt(p.position_sec)}${p.duration_sec ? ' / ' + fmt(p.duration_sec) : ''}${p.remaining_min != null ? ' · ' + Math.round(p.remaining_min) + ' min left' : ''}`
        }
      } else {
        stateLine.textContent = 'TV offline'
      }
    } catch { /* keep last */ }
  }
  const timer = setInterval(tick, 5000)
  tick()

  function fmt(sec) {
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  }

  return { card, close: () => { alive = false; clearInterval(timer); card.remove() } }
}

function PadChip({ rest }) {
  const [pop, setPop] = useState(null)
  const pillRef = useRef(null)

  useEffect(() => () => { if (pop) pop.close() }, [pop])

  const toggle = () => {
    haptic('tap')
    if (pop) { pop.close(); setPop(null); return }
    const el = pillRef.current
    const rect = el ? el.getBoundingClientRect() : { bottom: 48, right: window.innerWidth - 24 }
    const p = buildPopout(rest, null)
    p.card.style.top = (rect.bottom + 8) + 'px'
    p.card.style.right = (window.innerWidth - rect.right) + 'px'
    document.body.append(p.card)
    const onDoc = (e) => { if (!p.card.contains(e.target) && el && !el.contains(e.target)) { p.close(); setPop(null) } }
    setTimeout(() => document.addEventListener('mousedown', onDoc), 0)
    p.card._onDoc = onDoc
    setPop(p)
  }

  // cleanup outside-click listener when pop closes
  useEffect(() => {
    if (!pop) return
    const origClose = pop.close
    pop.close = () => { document.removeEventListener('mousedown', pop._onDoc); origClose() }
  }, [pop])

  const act = (action) => () => {
    haptic('tap')
    rest('/press', { method: 'POST', body: { action } }).catch(() => {})
  }

  return jsx('span', {
    className: 'inline-flex items-center',
    children: jsx('span', {
      ref: pillRef,
      className:
        'inline-flex items-stretch rounded-full border border-(--ui-stroke-tertiary) ' +
        'bg-(--ui-surface-secondary) overflow-hidden shadow-sm',
      children: [
        jsx('button', {
          className:
            'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
            'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none',
          type: 'button', onClick: act('play_pause'), children: '⏯'
        }),
        jsx('button', {
          className:
            'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
            'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none',
          type: 'button', onClick: act('vol_down'), children: '−'
        }),
        jsx('button', {
          className:
            'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
            'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none',
          type: 'button', onClick: act('vol_up'), children: '+'
        }),
        jsx('button', {
          className:
            'inline-flex items-center justify-center min-w-8 px-2.5 py-1 my-0.5 text-[0.6875rem] leading-none ' +
            'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground transition-colors select-none',
          type: 'button', onClick: act('next'), children: '⏭'
        }),
        jsx('button', {
          className:
            'inline-flex items-center justify-center min-w-6 px-1.5 text-[0.6875rem] ' +
            'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground ' +
            'transition-colors select-none border-l border-(--ui-stroke-tertiary)',
          type: 'button', title: 'TV remote - open controls', onClick: toggle, children: '▾'
        })
      ]
    })
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