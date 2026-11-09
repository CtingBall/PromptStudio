<script setup lang="ts">
// One tag: English + Chinese line. Double-click a line to edit it in a box that
// grows with the text (width up to 32em, then wraps and grows in height).
import { ref, nextTick } from 'vue'
import type { Tag } from '../lib/types'

const props = defineProps<{ tag: Tag }>()
const emit = defineEmits<{ (e: 'remove'): void; (e: 'change'): void }>()

const editing = ref<'none' | 'en' | 'zh'>('none')
const box = ref<HTMLTextAreaElement>()
const setBox = (el: unknown) => { if (el) box.value = el as HTMLTextAreaElement }

function fit() {
  const el = box.value
  if (!el) return
  const text = el.value || el.placeholder || ' '
  // CJK chars are ~2ch wide
  const len = Math.max(...text.split('\n').map((l) => [...l].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0)))
  el.style.width = `min(32em, ${Math.max(6, len + 2)}ch)`
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 2 + 'px'
}

async function startEdit(which: 'en' | 'zh') {
  editing.value = which
  await nextTick()
  // stop the draggable wrapper from hijacking text selection while editing
  const w = box.value?.closest('[draggable]') as HTMLElement | null
  if (w) w.draggable = false
  fit()
  box.value?.focus()
  box.value?.select()
}

function commit() {
  if (editing.value === 'none') return
  const w = box.value?.closest('[draggable]') as HTMLElement | null
  if (w) w.draggable = true
  editing.value = 'none'
  props.tag.en = props.tag.en.replace(/\s*\n\s*/g, ' ').trim()
  props.tag.zh = props.tag.zh.replace(/\s*\n\s*/g, ' ').trim()
  emit('change')
}

function bump(delta: number) {
  props.tag.weight = Math.min(2, Math.max(0.1, Math.round((props.tag.weight + delta) * 100) / 100))
  emit('change')
}
</script>

<template>
  <div class="tag-chip" :class="{ editing: editing !== 'none' }" :title="tag.en + (tag.zh ? '  →  ' + tag.zh : '')">
    <span v-if="tag.weight !== 1" class="w">{{ tag.weight }}</span>
    <template v-for="k in (['en', 'zh'] as const)" :key="k">
      <textarea v-if="editing === k" :ref="setBox" v-model="tag[k]" class="chip-edit" rows="1"
        :placeholder="k === 'zh' ? '中文' : 'english tag'" draggable="false"
        @input="fit" @blur="commit" @keydown.enter.exact.prevent="commit" @keydown.esc="commit"
        @dragstart.stop.prevent @pointerdown.stop />
      <span v-else :class="k" @dblclick="startEdit(k)">{{ tag[k] || (k === 'en' ? '…' : '（未译）') }}</span>
    </template>
    <div class="chip-ctl">
      <button class="ghost" title="降低权重" @click="bump(-0.1)">−</button>
      <button class="ghost" title="提高权重" @click="bump(0.1)">＋</button>
      <button class="ghost danger" title="删除" @click="emit('remove')">×</button>
    </div>
  </div>
</template>
