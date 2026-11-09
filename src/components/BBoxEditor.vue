<script setup lang="ts">
// Layout canvas: drag on empty space to draw a box, drag a box to move it,
// drag its corner handles to resize. Coordinates are stored as 0–1 fractions.
import { ref, computed, onBeforeUnmount } from 'vue'
import type { Region } from '../lib/types'
import { uid } from '../lib/tags'

const props = defineProps<{
  regions: Region[]
  canvas: { w: number; h: number }
  selected: string
  background?: string // optional reference image under the boxes
  grid: number        // snap divisions per side; 0 = free
}>()
const emit = defineEmits<{
  (e: 'update:selected', id: string): void
  (e: 'change'): void
}>()

const box = ref<HTMLDivElement>()
const cw = computed(() => Math.max(1, props.canvas.w || 1))
const ch = computed(() => Math.max(1, props.canvas.h || 1))
const ratio = computed(() => `${cw.value} / ${ch.value}`)
// width chosen so the canvas also fits in 60vh for portrait sizes
const width = computed(() => `min(100%, calc(60vh * ${cw.value / ch.value}))`)
const gridBg = computed(() => {
  const n = props.grid || 8
  return {
    backgroundImage:
      'linear-gradient(to right, var(--grid-line) 1px, transparent 1px),' +
      'linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px)',
    backgroundSize: `${100 / n}% ${100 / n}%`,
  }
})

const color = (i: number) => `hsl(${(i * 67) % 360} 85% 60%)`
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
function snap(v: number) {
  if (!props.grid) return v
  return Math.round(v * props.grid) / props.grid
}
function point(e: PointerEvent) {
  const r = box.value!.getBoundingClientRect()
  return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
}

type Drag =
  | { kind: 'draw'; r: Region; x0: number; y0: number }
  | { kind: 'move'; r: Region; dx: number; dy: number }
  | { kind: 'resize'; r: Region; corner: string; fx: number; fy: number }
let drag: Drag | null = null

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  const p = point(e)
  props.regions.push({ id: uid('r'), x: snap(p.x), y: snap(p.y), w: 0, h: 0, text: '' })
  // Use the reactive proxy from the array; mutating the raw object would not re-render while drawing.
  const r = props.regions[props.regions.length - 1]
  drag = { kind: 'draw', r, x0: r.x, y0: r.y }
  emit('update:selected', r.id)
  listen()
}
function onBoxDown(r: Region, e: PointerEvent) {
  e.stopPropagation()
  if (e.button !== 0) return
  const p = point(e)
  drag = { kind: 'move', r, dx: p.x - r.x, dy: p.y - r.y }
  emit('update:selected', r.id)
  listen()
}
function onHandleDown(r: Region, corner: string, e: PointerEvent) {
  e.stopPropagation()
  if (e.button !== 0) return
  // fixed (opposite) corner stays put while resizing
  const fx = corner.includes('w') ? r.x + r.w : r.x
  const fy = corner.includes('n') ? r.y + r.h : r.y
  drag = { kind: 'resize', r, corner, fx, fy }
  emit('update:selected', r.id)
  listen()
}
function onMove(e: PointerEvent) {
  if (!drag) return
  const p = point(e)
  const r = drag.r
  if (drag.kind === 'move') {
    r.x = clamp(snap(p.x - drag.dx), 0, 1 - r.w)
    r.y = clamp(snap(p.y - drag.dy), 0, 1 - r.h)
  } else {
    const ax = drag.kind === 'draw' ? drag.x0 : drag.fx
    const ay = drag.kind === 'draw' ? drag.y0 : drag.fy
    const bx = snap(p.x), by = snap(p.y)
    r.x = Math.min(ax, bx); r.y = Math.min(ay, by)
    r.w = Math.abs(bx - ax); r.h = Math.abs(by - ay)
    if (drag.kind === 'resize') {
      // never collapse an existing box to zero; grow away from the fixed corner
      const min = Math.max(props.grid ? 1 / props.grid : 0, 0.02)
      if (r.w < min) { r.w = min; r.x = bx < ax ? ax - min : ax; r.x = clamp(r.x, 0, 1 - min) }
      if (r.h < min) { r.h = min; r.y = by < ay ? ay - min : ay; r.y = clamp(r.y, 0, 1 - min) }
    }
  }
}
function onUp() {
  if (drag) {
    const r = drag.r
    // discard accidental clicks that made a tiny box
    if (drag.kind === 'draw' && (r.w < 0.02 || r.h < 0.02)) {
      const i = props.regions.indexOf(r)
      if (i >= 0) props.regions.splice(i, 1)
      emit('update:selected', '')
    } else emit('change')
  }
  drag = null
  unlisten()
}
function listen() {
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
function unlisten() {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
}
onBeforeUnmount(unlisten)

const pct = (v: number) => `${v * 100}%`
</script>

<template>
  <div ref="box" class="bbox-canvas" :style="{ aspectRatio: ratio, width, ...gridBg }" @pointerdown="onDown">
    <img v-if="background" :src="background" class="bbox-bg" draggable="false" />
    <div
      v-for="(r, i) in regions"
      :key="r.id"
      class="bbox"
      :class="{ on: r.id === selected }"
      :style="{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h), borderColor: color(i), background: color(i).replace(')', ' / .14)') }"
      @pointerdown="onBoxDown(r, $event)"
    >
      <span class="bbox-label" :style="{ background: color(i) }">#{{ i + 1 }} {{ r.text.slice(0, 24) }}</span>
      <template v-if="r.id === selected">
        <i v-for="c in ['nw', 'ne', 'sw', 'se']" :key="c" :class="['bbox-h', c]" @pointerdown="onHandleDown(r, c, $event)" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.bbox-canvas { position: relative; display: block; background-color: var(--canvas);
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden; cursor: crosshair; user-select: none;
  touch-action: none; margin: 0 auto; }
.bbox-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .35; pointer-events: none; }
.bbox { position: absolute; will-change: left, top, width, height; border: 2px solid; border-radius: 4px; cursor: move; box-sizing: border-box; }
.bbox.on { border-style: dashed; box-shadow: 0 0 0 2px var(--accent-soft); }
.bbox-label { position: absolute; left: 0; top: 0; color: #0b1220; font-size: 11px; padding: 0 4px;
  max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; border-bottom-right-radius: 4px; }
.bbox-h { position: absolute; width: 10px; height: 10px; background: #fff; border-radius: 2px; }
.bbox-h.nw { left: -6px; top: -6px; cursor: nwse-resize; }
.bbox-h.se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.bbox-h.ne { right: -6px; top: -6px; cursor: nesw-resize; }
.bbox-h.sw { left: -6px; bottom: -6px; cursor: nesw-resize; }
</style>
