<script setup lang="ts">
// Version history of one set: list of saved states, word-level diff against the
// current prompt, and one-click rollback (the current state is saved first).
import { ref, computed } from 'vue'
import type { PromptSet, SetVersion } from '../lib/types'
import { restoreVersion, touch } from '../lib/store'
import { serializeTag } from '../lib/tags'

const props = defineProps<{ set: PromptSet }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'toast', msg: string): void }>()

const list = computed(() => props.set.history || [])
const pick = ref(0)
const v = computed<SetVersion | undefined>(() => list.value[pick.value])

const words = (tags: { en: string; weight: number }[]) => tags.map((t) => serializeTag(t as any))
const diff = computed(() => {
  if (!v.value) return { add: [] as string[], del: [] as string[], same: 0 }
  const now = words(props.set.tags), old = words(v.value.tags)
  const a = new Set(now), b = new Set(old)
  return { add: old.filter((x) => !a.has(x)), del: now.filter((x) => !b.has(x)), same: old.filter((x) => a.has(x)).length }
})
const time = (t: number) => new Date(t).toLocaleString()

function restore() {
  if (!v.value) return
  restoreVersion(props.set, v.value)
  emit('toast', '已回退到：' + v.value.label + '（回退前的状态也已存进历史）')
  emit('close')
}
function remove() {
  if (!props.set.history) return
  props.set.history.splice(pick.value, 1)
  pick.value = Math.max(0, pick.value - 1)
  touch(props.set)
}
</script>

<template>
  <div class="modal-mask">
    <div class="modal" style="width: min(900px, 94vw)">
      <div class="row">
        <h3 style="margin: 0">🕘 历史版本 · {{ set.name }}</h3>
        <span class="spacer" />
        <button class="ghost" @click="emit('close')">关闭</button>
      </div>
      <p v-if="!list.length" class="muted">还没有历史。AI 修改、全部重翻、编辑原文、批量删除之前会自动保存一份，最多保留 15 个。</p>
      <div v-else style="display: grid; grid-template-columns: 260px 1fr; gap: 12px; margin-top: 10px">
        <div class="hist-list">
          <div v-for="(h, i) in list" :key="h.at" :class="['hist-item', { on: i === pick }]" @click="pick = i">
            <div>{{ h.label }}</div>
            <div class="muted" style="font-size: 12px">{{ time(h.at) }} · {{ h.tags.length }} 个标签</div>
          </div>
        </div>
        <div v-if="v" style="min-width: 0">
          <p class="muted" style="margin-top: 0">和当前相比：相同 {{ diff.same }} 个，回退后会<span class="diff-add">恢复 {{ diff.add.length }} 个</span>、<span class="diff-del">去掉 {{ diff.del.length }} 个</span>。</p>
          <div v-if="diff.add.length" style="margin-bottom: 8px"><strong>会恢复：</strong>
            <span v-for="w in diff.add" :key="'a' + w" class="diff-add" style="margin-right: 8px">{{ w }}</span></div>
          <div v-if="diff.del.length" style="margin-bottom: 8px"><strong>会去掉：</strong>
            <span v-for="w in diff.del" :key="'d' + w" class="diff-del" style="margin-right: 8px">{{ w }}</span></div>
          <div v-if="v.negative !== set.negative" class="muted" style="font-size: 12px; margin-bottom: 8px">负向词也不同：{{ v.negative || '（空）' }}</div>
          <textarea class="out-box" rows="8" readonly :value="words(v.tags).join(', ')" />
          <div class="row" style="margin-top: 10px">
            <button class="ghost danger" @click="remove">删除这个版本</button>
            <span class="spacer" />
            <button class="primary" @click="restore">回退到这个版本</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
