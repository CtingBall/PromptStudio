<script setup lang="ts">
// Canvas size + snap grid + box list around BBoxEditor. Mutates the given
// regions array / canvas object in place (they live on a PromptSet or in the
// generate dialog).
import { ref, computed } from 'vue'
import BBoxEditor from './BBoxEditor.vue'
import type { Region } from '../lib/types'
import { describeBox } from '../lib/translate'

const props = defineProps<{
  regions: Region[]
  canvas: { w: number; h: number }
  background?: string
}>()
const emit = defineEmits<{ (e: 'change'): void }>()

// Aspect ratio + total pixels → size rounded to multiples of 16.
const RATIOS: Array<[string, number, number]> = [
  ['1:1', 1, 1], ['2:3', 2, 3], ['3:2', 3, 2], ['3:4', 3, 4], ['4:3', 4, 3],
  ['9:16', 9, 16], ['16:9', 16, 9], ['21:9', 21, 9],
]
const PIXELS = [
  { label: '1MP', v: 1024 * 1024 },
  { label: '1.5MP', v: 1536 * 1024 },
  { label: '2MP', v: 2048 * 1024 },
]
const mp = ref(PIXELS[0].v)
const r16 = (v: number) => Math.max(256, Math.round(v / 16) * 16)
const ratioIdx = computed({
  get: () => RATIOS.findIndex(([, a, b]) => Math.abs(props.canvas.w / props.canvas.h - a / b) < 0.02),
  set: (i: number) => { if (i >= 0) applyRatio(i) },
})
function applyRatio(i: number) {
  const [, a, b] = RATIOS[i]
  props.canvas.w = r16(Math.sqrt((mp.value * a) / b))
  props.canvas.h = r16(Math.sqrt((mp.value * b) / a))
  emit('change')
}
function onMp() { if (ratioIdx.value >= 0) applyRatio(ratioIdx.value) }
const grid = ref(8)
const selected = ref('')

function remove(id: string) {
  const i = props.regions.findIndex((r) => r.id === id)
  if (i >= 0) props.regions.splice(i, 1)
  if (selected.value === id) selected.value = ''
  emit('change')
}
function clearAll() {
  if (!props.regions.length || !confirm('清空所有框？')) return
  props.regions.splice(0)
  emit('change')
}
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value) remove(selected.value)
}
</script>

<template>
  <div tabindex="0" style="outline: none" @keydown="onKey">
    <div class="row" style="gap: 6px; flex-wrap: wrap; margin-bottom: 8px">
      <button v-for="(r, i) in RATIOS" :key="r[0]" :class="ratioIdx === i ? 'primary' : 'ghost'"
        style="padding: 2px 8px" @click="ratioIdx = i">{{ r[0] }}</button>
      <select v-model.number="mp" style="width: auto" title="总像素" @change="onMp">
        <option v-for="p in PIXELS" :key="p.v" :value="p.v">{{ p.label }}</option>
      </select>
      <span class="muted" style="font-size: 12px">自定义</span>
      <input v-model.number="canvas.w" type="number" step="16" min="256" max="4096" style="width: 76px" @change="emit('change')" />
      ×
      <input v-model.number="canvas.h" type="number" step="16" min="256" max="4096" style="width: 76px" @change="emit('change')" />
      <label class="muted">吸附网格
        <select v-model.number="grid" style="width: auto">
          <option :value="0">关</option>
          <option :value="4">4×4</option>
          <option :value="8">8×8</option>
          <option :value="12">12×12</option>
          <option :value="16">16×16</option>
        </select>
      </label>
      <span class="spacer" />
      <button class="ghost danger" @click="clearAll">清空</button>
    </div>

    <BBoxEditor v-model:selected="selected" :regions="regions" :canvas="canvas" :grid="grid"
      :background="background" @change="emit('change')" />
    <p class="muted" style="font-size: 12px; margin: 6px 0">
      在空白处拖动画框；拖框移动，拖白色角点缩放；选中后按 Delete 删除。
    </p>

    <div style="display: flex; flex-direction: column; gap: 6px">
      <div v-for="(r, i) in regions" :key="r.id" class="row"
        :style="{ gap: '6px', padding: '4px', borderRadius: '6px', background: r.id === selected ? 'var(--panel2)' : '' }"
        @click="selected = r.id">
        <span class="badge" :style="{ color: `hsl(${(i * 67) % 360} 85% 60%)` }">#{{ i + 1 }}</span>
        <span class="muted" style="font-size: 12px; width: 120px">{{ describeBox(r) }}</span>
        <input v-model="r.text" placeholder="框里有什么，例如：持剑少女 / 满月 / 倒塌的钟楼" style="flex: 1" @change="emit('change')" />
        <button class="ghost danger" style="padding: 0 6px" @click.stop="remove(r.id)">×</button>
      </div>
    </div>
  </div>
</template>
