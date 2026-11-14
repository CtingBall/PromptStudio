<script setup lang="ts">
import { useDragSelect, listSetter } from '../lib/dragSelect'
import { ref, computed } from 'vue'
import { doc } from '../lib/store'
import { CATEGORIES, RATING_LABEL, type Category } from '../lib/types'
import { imgSrc, imageCache } from '../lib/imagedb'
import { exportSets, readFiles, applyImport, type ImageMode, type Candidate, type ConflictMode } from '../lib/transfer'

const props = defineProps<{ mode: 'export' | 'import'; preselect?: string[]; current?: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'toast', msg: string): void; (e: 'select', id: string): void }>()

const tab = ref(props.mode)
const busy = ref(false)

// ---------- export ----------
const sel = ref<string[]>(props.preselect?.length ? [...props.preselect] : props.current ? [props.current] : [])
const q = ref('')
const rating = ref<'ALL' | Category>('ALL')
const imgMode = ref<ImageMode>('all')
const split = ref(false)
const shown = computed(() => {
  const k = q.value.trim().toLowerCase()
  return doc.sets.filter((s) => (rating.value === 'ALL' || s.category === rating.value)
    && (!k || [s.name, s.folder, ...(s.labels || [])].join(' ').toLowerCase().includes(k)))
})
const { start: dragStart, over: dragOver } = useDragSelect()
const setSel = listSetter(sel)
const setPick = (i: string, on: boolean) => { const c = cands.value[+i]; if (c) c.pick = on }
function pickShown(on: boolean) {
  const ids = shown.value.map((s) => s.id)
  sel.value = on ? [...new Set([...sel.value, ...ids])] : sel.value.filter((x) => !ids.includes(x))
}
const chosen = computed(() => doc.sets.filter((s) => sel.value.includes(s.id)))
const imgCount = computed(() => chosen.value.reduce((n, s) =>
  n + (imgMode.value === 'none' ? 0 : imgMode.value === 'cover' ? Math.min(1, s.shots?.length || 0) : s.shots?.length || 0), 0))
const estMB = computed(() => {
  let b = 0
  for (const s of chosen.value) {
    const shots = imgMode.value === 'none' ? [] : imgMode.value === 'cover' ? (s.shots || []).slice(0, 1) : s.shots || []
    for (const x of shots) b += imageCache[x.id]?.length || 300_000
  }
  return (b / 1048576).toFixed(1)
})
async function doExport() {
  if (!chosen.value.length) return
  busy.value = true
  try {
    const bytes = await exportSets(chosen.value, imgMode.value, split.value)
    emit('toast', `已导出 ${chosen.value.length} 组（${(bytes / 1048576).toFixed(1)} MB）`)
    emit('close')
  } catch (e: any) { emit('toast', '导出失败：' + (e?.message || e)) } finally { busy.value = false }
}

// ---------- import ----------
const cands = ref<Candidate[]>([])
const dict = ref<Record<string, string>>({})
const errors = ref<string[]>([])
const conflict = ref<ConflictMode>('copy')
const hover = ref(false)
const fileEl = ref<HTMLInputElement>()
async function load(files: FileList | File[] | null | undefined) {
  if (!files?.length) return
  busy.value = true
  try {
    const r = await readFiles(Array.from(files))
    cands.value.push(...r.list)
    Object.assign(dict.value, r.dict)
    errors.value.push(...r.errors)
  } finally { busy.value = false }
}
const picked = computed(() => cands.value.filter((c) => c.pick))
const conflicts = computed(() => picked.value.filter((c) => c.conflict && !c.dupOf).length)
const candSrc = (c: Candidate) => { const id = c.set.shots?.[0]?.id; return id ? c.images[id] : '' }
async function doImport() {
  busy.value = true
  try {
    const r = await applyImport(cands.value, dict.value, conflict.value)
    emit('toast', `已导入 ${r.added.length} 组` + (r.merged ? `；${r.merged} 组提示词重复，已把 ${r.shotsAdded} 张新返图加到原组` : '') + (r.skipped ? `；跳过 ${r.skipped} 组完全重复` : ''), )
    if (r.added[0]) emit('select', r.added[0].id)
    emit('close')
  } catch (e: any) { emit('toast', '导入失败：' + (e?.message || e)) } finally { busy.value = false }
}
</script>

<template>
  <div class="modal-mask">
    <div class="modal" style="width: 760px">
      <div class="row" style="margin-bottom: 10px">
        <div class="seg" style="width: 220px">
          <button :class="{ on: tab === 'export' }" @click="tab = 'export'">导出</button>
          <button :class="{ on: tab === 'import' }" @click="tab = 'import'">导入</button>
        </div>
        <span class="spacer" />
        <button class="ghost" :disabled="busy" @click="emit('close')">✕</button>
      </div>

      <!-- EXPORT -->
      <template v-if="tab === 'export'">
        <div class="row" style="gap: 6px; flex-wrap: wrap">
          <input v-model="q" placeholder="🔍 名称 / 文件夹 / 标签" style="flex: 1; min-width: 160px" />
          <select v-model="rating" style="width: auto">
            <option value="ALL">全部分级</option>
            <option v-for="c in CATEGORIES" :key="c" :value="c">{{ RATING_LABEL[c] }}</option>
          </select>
          <button class="ghost sm" @click="pickShown(true)">全选列表</button>
          <button class="ghost sm" @click="pickShown(false)">取消列表</button>
          <span class="muted" style="font-size: .82em">按住左键上下拖动可连选</span>
        </div>
        <div class="xfer-list">
          <label v-for="s in shown" :key="s.id" :class="['xfer-item', { picked: sel.includes(s.id) }]"
            @mousedown="dragStart($event, s.id, sel.includes(s.id), setSel)" @mouseenter="dragOver(s.id)" @click.prevent>
            <input type="checkbox" :checked="sel.includes(s.id)" style="width: auto; pointer-events: none" tabindex="-1" />
            <div class="thumb"><img v-if="s.shots?.length && imgSrc(s.shots[0].id)" :src="imgSrc(s.shots[0].id)" /><span v-else>{{ s.name.slice(0, 1) }}</span></div>
            <div style="flex: 1; min-width: 0">
              <div class="set-name">{{ s.name }}</div>
              <div class="set-sub">
                <span v-if="s.category" :class="['rtag', 'r-' + s.category]">{{ RATING_LABEL[s.category] }}</span>
                <span v-if="s.folder" class="muted">📁{{ s.folder }}</span>
                <span class="muted">{{ s.tags.length }}词</span>
                <span v-if="s.shots?.length" class="muted">🖼{{ s.shots.length }}</span>
              </div>
            </div>
          </label>
        </div>
        <div class="row" style="gap: 14px; flex-wrap: wrap; margin-top: 10px">
          <span>返图：</span>
          <label class="row" style="gap: 4px"><input v-model="imgMode" type="radio" value="all" style="width: auto" />全部</label>
          <label class="row" style="gap: 4px"><input v-model="imgMode" type="radio" value="cover" style="width: auto" />只带封面</label>
          <label class="row" style="gap: 4px"><input v-model="imgMode" type="radio" value="none" style="width: auto" />不带</label>
          <span class="spacer" />
          <label class="row" style="gap: 4px" title="否则合成一个文件"><input v-model="split" type="checkbox" style="width: auto" />每组单独一个文件</label>
        </div>
        <div class="row" style="margin-top: 12px">
          <span class="muted">已选 {{ chosen.length }} 组 · {{ imgCount }} 张返图 · 约 {{ estMB }} MB · 不含 API 地址/Key</span>
          <span class="spacer" />
          <button class="primary" :disabled="!chosen.length || busy" @click="doExport">{{ busy ? '导出中…' : '导出' }}</button>
        </div>
      </template>

      <!-- IMPORT -->
      <template v-else>
        <div :class="['drop', { hover }]" style="padding: 18px; text-align: center; cursor: pointer"
          @click="fileEl?.click()" @dragover.prevent="hover = true" @dragleave="hover = false"
          @drop.prevent="hover = false; load($event.dataTransfer?.files)">
          {{ busy ? '读取中…' : '点击选择或拖入文件（可多选）' }}
          <div class="muted" style="font-size: 12px; margin-top: 4px">
            支持：本工具导出的 .json（含返图）· .txt 提示词 · 带生成参数的 PNG（每张图建一组并作为返图）
          </div>
        </div>
        <input ref="fileEl" type="file" multiple accept=".json,.txt,image/*" style="display: none"
          @change="load(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''" />

        <div v-for="(e, i) in errors" :key="i" style="color: var(--danger); font-size: 12px; margin-top: 4px">{{ e }}</div>

        <template v-if="cands.length">
          <div class="row" style="margin-top: 10px; gap: 6px">
            <strong>预览</strong>
            <span class="muted">{{ picked.length }} / {{ cands.length }} 组</span>
            <span class="spacer" />
            <button class="ghost sm" @click="cands.forEach((c) => (c.pick = true))">全选</button>
            <button class="ghost sm" @click="cands.forEach((c) => (c.pick = false))">全不选</button>
            <button class="ghost sm" @click="cands = []; errors = []">清空</button>
          </div>
          <div class="xfer-list">
            <label v-for="(c, i) in cands" :key="i" :class="['xfer-item', { picked: c.pick }]"
              @mousedown="dragStart($event, String(i), c.pick, setPick)" @mouseenter="dragOver(String(i))" @click.prevent>
              <input :checked="c.pick" type="checkbox" style="width: auto; pointer-events: none" tabindex="-1" />
              <div class="thumb"><img v-if="candSrc(c)" :src="candSrc(c)" /><span v-else>{{ c.set.name.slice(0, 1) }}</span></div>
              <div style="flex: 1; min-width: 0">
                <div class="set-name">{{ c.set.name }}</div>
                <div class="set-sub">
                  <span v-if="c.set.category" :class="['rtag', 'r-' + c.set.category]">{{ RATING_LABEL[c.set.category] }}</span>
                  <span class="muted">{{ c.set.tags.length }}词</span>
                  <span v-if="c.set.shots?.length" class="muted">🖼{{ c.set.shots.length }}</span>
                  <span class="muted">{{ c.source }}</span>
                  <span v-if="c.dupOf" class="rtag r-SFW" :title="'和「' + c.dupOf + '」提示词相同，不会新建；带的新返图会加到那一组'">重复 → 只加返图</span>
                  <span v-else-if="c.conflict" class="rtag r-SFW">已存在</span>
                </div>
              </div>
            </label>
          </div>
          <div class="row" style="margin-top: 10px; gap: 14px; flex-wrap: wrap">
            <span>已存在的组（{{ conflicts }}）：</span>
            <label class="row" style="gap: 4px"><input v-model="conflict" type="radio" value="copy" style="width: auto" />另存副本</label>
            <label class="row" style="gap: 4px"><input v-model="conflict" type="radio" value="overwrite" style="width: auto" />覆盖</label>
            <label class="row" style="gap: 4px"><input v-model="conflict" type="radio" value="skip" style="width: auto" />跳过</label>
            <span class="spacer" />
            <button class="primary" :disabled="!picked.length || busy" @click="doImport">导入 {{ picked.length }} 组</button>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
