// Small visual effects. All of them are skipped when motion is off
// (Settings → 外观 → 动画, or the OS "reduce motion" switch).
import { ui } from './ui'

export function motionOn(): boolean {
  if (!ui.motion) return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

const BURST = ['❤', '✦', '✿', '★', '♪']

/** Particle burst from an element (or a point), e.g. after copying. */
export function burst(at: Element | { x: number; y: number } | null | undefined, n = 12) {
  if (!at || !motionOn()) return
  let x: number, y: number
  if (at instanceof Element) {
    const r = at.getBoundingClientRect()
    x = r.left + r.width / 2; y = r.top + r.height / 2
  } else ({ x, y } = at)
  const layer = document.createElement('div')
  layer.className = 'fx-layer'
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span')
    p.className = 'fx-p'
    p.textContent = BURST[i % BURST.length]
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.5
    const d = 40 + Math.random() * 46
    p.style.left = x + 'px'; p.style.top = y + 'px'
    p.style.setProperty('--dx', Math.cos(a) * d + 'px')
    p.style.setProperty('--dy', Math.sin(a) * d - 18 + 'px')
    p.style.setProperty('--rot', (Math.random() * 120 - 60).toFixed(0) + 'deg')
    p.style.setProperty('--hue', String(Math.floor(Math.random() * 60) - 30))
    p.style.animationDelay = Math.random() * 60 + 'ms'
    layer.appendChild(p)
  }
  document.body.appendChild(layer)
  window.setTimeout(() => layer.remove(), 1100)
}

/** Burst at the element the current click came from. */
export function burstEvent(e?: Event | null) {
  const t = (e?.currentTarget || e?.target) as Element | null
  burst(t)
}

/** Restart a one-shot CSS animation class on an element. */
export function pulse(el: Element | null | undefined, cls = 'fx-bump') {
  if (!el || !motionOn()) return
  el.classList.remove(cls)
  void (el as HTMLElement).offsetWidth
  el.classList.add(cls)
}

// The last thing the user pressed, so async actions (copy, save) can burst from it.
let lastEl: Element | null = null
window.addEventListener('pointerdown', (e) => { lastEl = (e.target as Element)?.closest?.('button') || null }, true)
/** Burst from the button the user last pressed (if it is still on screen). */
export function burstHere(n = 12) {
  if (lastEl && lastEl.isConnected) burst(lastEl, n)
}
