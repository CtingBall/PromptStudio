// UI preferences (theme, zoom, panel widths). Stored apart from user data so
// layout changes never touch prompt sets.
import { reactive, watch } from 'vue'

export type Theme = 'sakura' | 'dark' | 'light' | 'warm'
export const THEMES: Array<{ id: Theme; label: string }> = [
  { id: 'sakura', label: '樱夜' },
  { id: 'dark', label: '暗色' },
  { id: 'light', label: '亮色' },
  { id: 'warm', label: '暖色' },
]

const KEY = 'prompt-studio-ui'
const DEF = { theme: 'sakura' as Theme, scale: 100, sideW: 280, asideW: 360, asideOpen: true, compact: false, tagsOpen: true, labelsOpen: false, cardSize: 35, closedSecs: [] as string[] }

function load() {
  try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEF } }
}
export const ui = reactive(load())

function apply() {
  const el = document.documentElement
  el.dataset.theme = ui.theme
  el.style.fontSize = `${(14 * ui.scale) / 100}px`
  el.style.setProperty('--side-w', ui.sideW + 'px')
  el.style.setProperty('--aside-w', ui.asideW + 'px')
  el.classList.toggle('compact', ui.compact)
}
apply()
watch(ui, () => { apply(); try { localStorage.setItem(KEY, JSON.stringify(ui)) } catch {} }, { deep: true })

export const clampW = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)))

// Start dragging a splitter. `get`/`set` read and write the width; dir=-1 when
// the panel sits right of the splitter (dragging left makes it wider).
export function dragSplit(e: PointerEvent, get: () => number, set: (v: number) => void, dir: 1 | -1) {
  e.preventDefault()
  const x0 = e.clientX, w0 = get()
  const move = (ev: PointerEvent) => set(w0 + (ev.clientX - x0) * dir)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.classList.remove('resizing')
  }
  document.body.classList.add('resizing')
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
