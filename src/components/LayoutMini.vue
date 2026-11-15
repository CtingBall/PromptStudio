<script setup lang="ts">
// Tiny read-only preview of a set's bbox layout (used on list items and in headers).
import { computed } from 'vue'
import type { PromptSet } from '../lib/types'
const props = defineProps<{ set: PromptSet; size?: number }>()
const box = computed(() => {
  const c = props.set.canvas || { w: 1, h: 1 }
  const s = props.size || 40
  const r = c.w / c.h
  return r >= 1 ? { w: s, h: Math.max(8, s / r) } : { w: Math.max(8, s * r), h: s }
})
const color = (k?: string) => (k === 'char' ? 'var(--c-nsfw)' : k === 'text' ? 'var(--c-sfw)' : 'var(--accent)')
</script>

<template>
  <svg class="layout-mini" :width="box.w" :height="box.h" viewBox="0 0 100 100" preserveAspectRatio="none">
    <rect x="0" y="0" width="100" height="100" class="lm-bg" />
    <rect v-for="r in set.regions || []" :key="r.id" :x="r.x * 100" :y="r.y * 100" :width="r.w * 100" :height="r.h * 100"
      :fill="color(r.kind)" fill-opacity=".28" :stroke="color(r.kind)" stroke-width="3" vector-effect="non-scaling-stroke" />
  </svg>
</template>
