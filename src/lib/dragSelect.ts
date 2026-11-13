// Press the left button on a row and sweep over others to tick (or untick) them all.
// The first row decides the direction: starting on an unticked row ticks, on a ticked row unticks.
import { ref } from 'vue'

export function useDragSelect() {
  const drag = ref<null | { on: boolean; apply: (k: string, on: boolean) => void }>(null)
  function start(e: MouseEvent, key: string, cur: boolean, apply: (k: string, on: boolean) => void) {
    if (e.button !== 0) return
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'checkbox') return
    if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return
    e.preventDefault()
    drag.value = { on: !cur, apply }
    apply(key, !cur)
    window.addEventListener('mouseup', () => (drag.value = null), { once: true })
  }
  function over(key: string) { drag.value?.apply(key, drag.value.on) }
  return { start, over, active: drag }
}

/** apply-function for a string[] selection ref */
export function listSetter(list: { value: string[] }) {
  return (id: string, on: boolean) => {
    const has = list.value.includes(id)
    if (on && !has) list.value = [...list.value, id]
    else if (!on && has) list.value = list.value.filter((x) => x !== id)
  }
}
