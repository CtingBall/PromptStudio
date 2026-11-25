// Windows-Explorer-like selection for an ordered list of item keys:
// click / Ctrl+click / Shift+click / Ctrl+Shift+click, keyboard moves and rubber-band selection.
import { ref, type Ref } from 'vue'

export function useSelection(order: () => string[]) {
  const sel = ref<string[]>([])
  const anchor = ref('')   // start of Shift ranges
  const focus = ref('')    // keyboard cursor
  const has = (k: string) => sel.value.includes(k)
  function range(a: string, b: string): string[] {
    const o = order()
    let i = o.indexOf(a), j = o.indexOf(b)
    if (i < 0) i = j
    if (i > j) [i, j] = [j, i]
    return j < 0 ? [] : o.slice(i, j + 1)
  }
  /** Click on an item. Returns true for a plain click (the caller may open/preview the item). */
  function click(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, k: string): boolean {
    focus.value = k
    if (e.shiftKey && anchor.value) {
      const r = range(anchor.value, k)
      sel.value = e.ctrlKey || e.metaKey ? [...new Set([...sel.value, ...r])] : r
      return false
    }
    anchor.value = k
    if (e.ctrlKey || e.metaKey) { toggle(k); return false }
    sel.value = [k]
    return true
  }
  function toggle(k: string) { sel.value = has(k) ? sel.value.filter((x) => x !== k) : [...sel.value, k]; focus.value = k }
  function set(keys: string[], a = keys[0] || '') { sel.value = [...keys]; anchor.value = a; focus.value = keys[keys.length - 1] || a }
  function clear() { sel.value = [] }
  function all() { sel.value = order() }
  function prune() { const o = new Set(order()); sel.value = sel.value.filter((k) => o.has(k)) }
  /** Move the keyboard cursor by `d` items; with shift extend the selection from the anchor. */
  function move(d: number, shift: boolean): string {
    const o = order()
    if (!o.length) return ''
    const i = o.indexOf(focus.value)
    const n = i < 0 ? (d > 0 ? 0 : o.length - 1) : Math.max(0, Math.min(o.length - 1, i + d))
    const k = o[n]
    if (shift && anchor.value) { focus.value = k; sel.value = range(anchor.value, k) }
    else { sel.value = [k]; anchor.value = k; focus.value = k }
    return k
  }
  return { sel, anchor, focus, has, click, toggle, set, clear, all, prune, move }
}

/** Rubber-band (marquee) selection inside a scrolling container.
 *  Items need a `data-key` attribute. Starting on empty space clears the selection
 *  (Ctrl keeps it), dragging selects every item the rectangle touches. */
export function useMarquee(box: Ref<HTMLElement | null>, onSelect: (keys: string[], add: boolean) => void) {
  const rect = ref<null | { x: number; y: number; w: number; h: number }>(null)
  let sx = 0, sy = 0, add = false, base: string[] = [], moved = false
  function start(e: PointerEvent, current: string[]) {
    const el = box.value
    if (!el || e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-key], button, input, select, textarea')) return
    const r = el.getBoundingClientRect()
    sx = e.clientX - r.left + el.scrollLeft; sy = e.clientY - r.top + el.scrollTop
    add = e.ctrlKey || e.metaKey || e.shiftKey; base = add ? current : []; moved = false
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }
  function move(e: PointerEvent) {
    const el = box.value
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left + el.scrollLeft, y = e.clientY - r.top + el.scrollTop
    if (!moved && Math.abs(x - sx) + Math.abs(y - sy) < 5) return
    moved = true
    // auto-scroll near the edges
    if (e.clientY > r.bottom - 24) el.scrollTop += 12
    else if (e.clientY < r.top + 24) el.scrollTop -= 12
    const R = { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) }
    rect.value = R
    const hit: string[] = []
    for (const it of el.querySelectorAll<HTMLElement>('[data-key]')) {
      const b = it.getBoundingClientRect()
      const ix = b.left - r.left + el.scrollLeft, iy = b.top - r.top + el.scrollTop
      if (ix < R.x + R.w && ix + b.width > R.x && iy < R.y + R.h && iy + b.height > R.y) hit.push(it.dataset.key!)
    }
    onSelect([...new Set([...base, ...hit])], true)
  }
  function end() {
    window.removeEventListener('pointermove', move)
    if (!moved && !add) onSelect([], false)
    rect.value = null
  }
  return { rect, start }
}

/** Folder keys share the list with set ids; prefix them so they never collide. */
export const FK = 'f:'
export const isFolderKey = (k: string) => k.startsWith(FK)
export const folderOf = (k: string) => k.slice(FK.length)

/** Unique child name in a parent folder: 新建文件夹, 新建文件夹 (2), … */
export function freeName(existing: string[], parent: string, base = '新建文件夹'): string {
  const pre = parent ? parent + '/' : ''
  for (let i = 1; ; i++) {
    const n = i === 1 ? base : `${base} (${i})`
    if (!existing.includes(pre + n)) return n
  }
}
