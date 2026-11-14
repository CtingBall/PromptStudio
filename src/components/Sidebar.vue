<script setup lang="ts">
import { useDragSelect, listSetter } from '../lib/dragSelect'
import { ref, computed } from 'vue'
import { doc, addSet, newSet, touch, removeSets, folders, allLabels, promptText, fmtDate, dateBucket } from '../lib/store'
import { CATEGORIES, RATING_LABEL, type Category, type PromptSet } from '../lib/types'
import { imgSrc } from '../lib/imagedb'
import { aiClassify } from '../lib/ai'
import { ui } from '../lib/ui'

const props = defineProps<{ selected: string }>()
const emit = defineEmits<{ (e: 'update:selected', id: string): void; (e: 'toast', msg: string): void; (e: 'export', ids: string[]): void }>()

// ---- filters ----
const q = ref('')
const rating = ref<'ALL' | 'NONE' | Category>('ALL')
const folder = ref('')          // '' = all, '__none' = no folder
const label = ref<string[]>([])
const favOnly = ref(false)
const sort = ref<'manual' | 'updated' | 'created' | 'oldest' | 'name'>('manual')
const range = ref<'' | '1' | '7' | '30' | '90'>('')   // only sets created in the last N days

const visible = computed(() => {
  const k = q.value.trim().toLowerCase()
  let list = doc.sets.filter((s) => {
    if (rating.value === 'NONE' ? s.category : rating.value !== 'ALL' && s.category !== rating.value) return false
    if (folder.value === '__none' ? s.folder : folder.value && !(s.folder || '').startsWith(folder.value)) return false
    if (label.value.length && !label.value.every((l) => s.labels?.includes(l))) return false
    if (favOnly.value && !s.favorite) return false
    if (range.value && s.createdAt < Date.now() - Number(range.value) * 86400000) return false
    if (k) {
      const hay = [s.name, fmtDate(s.createdAt), s.folder, ...(s.labels || []), ...s.tags.map((t) => t.en + ' ' + t.zh)].join(' ').toLowerCase()
      if (!hay.includes(k)) return false
    }
    return true
  })
  if (sort.value === 'updated') list = [...list].sort((a, b) => b.updatedAt - a.updatedAt)
  if (sort.value === 'created') list = [...list].sort((a, b) => b.createdAt - a.createdAt)
  if (sort.value === 'oldest') list = [...list].sort((a, b) => a.createdAt - b.createdAt)
  if (sort.value === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return list
})
// date headers when sorted by date
const dateKey = computed(() => (sort.value === 'updated' ? 'updatedAt' : sort.value === 'created' || sort.value === 'oldest' ? 'createdAt' : ''))
function bucketAt(i: number): string {
  const k = dateKey.value
  if (!k) return ''
  const b = dateBucket(visible.value[i][k])
  return i === 0 || dateBucket(visible.value[i - 1][k]) !== b ? b : ''
}
// list density: 0–24 text only, 25–54 thumbnail rows, 55–100 stacked image cards (≥85: image only)
const mode = computed(() => (ui.cardSize < 25 ? 'mode-list' : ui.cardSize < 55 ? 'mode-row' : 'mode-card'))
const listStyle = computed(() => ({
  '--thumb': Math.round(28 + (Math.min(ui.cardSize, 54) - 25) * 1.6) + 'px',
  '--card-w': Math.round(90 + (ui.cardSize - 55) * 4.4) + 'px',
}))
const count = (c: 'ALL' | 'NONE' | Category) =>
  c === 'ALL' ? doc.sets.length : c === 'NONE' ? doc.sets.filter((s) => !s.category).length : doc.sets.filter((s) => s.category === c).length
function toggleLabel(l: string) {
  label.value = label.value.includes(l) ? label.value.filter((x) => x !== l) : [...label.value, l]
}

function create() {
  // a fresh set has no name match / labels / star, so clear filters that would hide it
  q.value = ''
  label.value = []
  favOnly.value = false
  const s = addSet()
  if (rating.value !== 'ALL' && rating.value !== 'NONE') s.category = rating.value
  if (folder.value && folder.value !== '__none') s.folder = folder.value
  emit('update:selected', s.id)
}

// ---- bulk ----
const bulk = ref(false)
const sel = ref<string[]>([])
const selSets = () => doc.sets.filter((s) => sel.value.includes(s.id))
const ds = useDragSelect()
const setSel = listSetter(sel)
function toggle(id: string) { sel.value = sel.value.includes(id) ? sel.value.filter((x) => x !== id) : [...sel.value, id] }
function selectAll() { sel.value = sel.value.length === visible.value.length ? [] : visible.value.map((s) => s.id) }
function bulkRating(c: string) {
  for (const s of selSets()) { s.category = c === 'NONE' ? undefined : (c as Category); touch(s) }
}
function bulkFolder() {
  const f = prompt('移动到文件夹（用 / 分级，留空 = 移出文件夹）', folder.value === '__none' ? '' : folder.value)
  if (f === null) return
  for (const s of selSets()) { s.folder = f.trim() || undefined; touch(s) }
}
function bulkLabel(add: boolean) {
  const l = prompt(add ? '添加标签（逗号分隔多个）' : '移除标签（逗号分隔多个）')
  if (!l) return
  const ls = l.split(/[,，]/).map((x) => x.trim()).filter(Boolean)
  for (const s of selSets()) {
    s.labels = add ? [...new Set([...(s.labels || []), ...ls])] : (s.labels || []).filter((x) => !ls.includes(x))
    touch(s)
  }
}
const aiBusy = ref('')
async function bulkClassify() {
  const list = selSets()
  for (let i = 0; i < list.length; i++) {
    aiBusy.value = `AI 整理 ${i + 1}/${list.length}`
    try {
      const r = await aiClassify(promptText(list[i], true), folders.value, allLabels.value)
      if (r.rating) list[i].category = r.rating
      if (r.folder) list[i].folder = r.folder
      list[i].labels = [...new Set([...(list[i].labels || []), ...r.labels])]
      if (r.name) list[i].name = r.name
      touch(list[i])
    } catch (e: any) { emit('toast', 'AI 整理失败：' + (e?.message || e)); break }
  }
  aiBusy.value = ''
}
function bulkDelete() {
  if (!sel.value.length) return
  const shownIds = new Set(visible.value.map((s) => s.id))
  const hidden = sel.value.filter((id) => !shownIds.has(id)).length
  if (!confirm(`删除选中的 ${sel.value.length} 个提示词组（含返图）？` + (hidden ? `\n注意：其中含 ${hidden} 个未显示（被筛选隐藏）的组。` : ''))) return
  removeSets(sel.value)
  if (!doc.sets.some((s) => s.id === props.selected)) emit('update:selected', doc.sets[0]?.id || '')
  sel.value = []
}

function bulkMerge() {
  const list = selSets()
  if (list.length < 2) { emit('toast', '选 2 个以上才能合并'); return }
  const s = newSet(list[0].name + ' 合并')
  const seen = new Set<string>()
  s.tags = list.flatMap((x) => x.tags).filter((t) => {
    const k = (t.section || '') + '|' + t.en.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k); return true
  }).map((t) => ({ ...t }))
  s.negative = [...new Set(list.flatMap((x) => x.negative.split(/[,，]/).map((n) => n.trim()).filter(Boolean)))].join(', ')
  s.category = list[0].category
  s.folder = list[0].folder
  s.labels = [...new Set(list.flatMap((x) => x.labels || []))]
  doc.sets.unshift(s)
  emit('update:selected', s.id)
  sel.value = []
  emit('toast', `已合并 ${list.length} 组`)
}

function onClick(s: PromptSet) { bulk.value ? toggle(s.id) : emit('update:selected', s.id) }

// ---- drag reorder (manual sort, unfiltered order) ----
const dragId = ref('')
const canDrag = computed(() => sort.value === 'manual')
function drop(t: PromptSet) {
  const from = doc.sets.findIndex((s) => s.id === dragId.value)
  const to = doc.sets.findIndex((s) => s.id === t.id)
  dragId.value = ''
  if (from < 0 || to < 0 || from === to) return
  const [m] = doc.sets.splice(from, 1)
  doc.sets.splice(to, 0, m)
}
</script>

<template>
  <aside class="side">
    <div class="side-top">
      <button class="primary" style="width: 100%" @click="create">＋ 新建提示词组</button>
      <input v-model="q" placeholder="🔍 搜索名称 / 标签 / 中英文词" style="width: 100%; margin-top: 8px" />

      <div class="seg" style="margin-top: 8px">
        <button v-for="c in (['ALL', ...CATEGORIES, 'NONE'] as const)" :key="c"
          :class="[rating === c ? 'on' : '', c !== 'ALL' && c !== 'NONE' ? 'r-' + c : '']" @click="rating = c">
          {{ c === 'ALL' ? '全部' : c === 'NONE' ? '未分级' : RATING_LABEL[c] }}<small>{{ count(c) }}</small>
        </button>
      </div>

      <div class="row" style="margin-top: 8px; gap: 6px">
        <select v-model="folder" style="flex: 1; min-width: 0">
          <option value="">📁 全部文件夹</option>
          <option value="__none">（无文件夹）</option>
          <option v-for="f in folders" :key="f" :value="f">{{ f }}</option>
        </select>
        <select v-model="sort" style="width: auto" title="排序">
          <option value="manual">手动</option>
          <option value="updated">最近修改</option>
          <option value="created">最新创建</option>
          <option value="oldest">最早创建</option>
          <option value="name">名称</option>
        </select>
        <select v-model="range" style="width: auto" title="按创建日期筛选">
          <option value="">全部日期</option>
          <option value="1">今天</option>
          <option value="7">7 天内</option>
          <option value="30">30 天内</option>
          <option value="90">90 天内</option>
        </select>
        <button :class="favOnly ? 'primary' : 'ghost'" title="只看收藏" @click="favOnly = !favOnly">★</button>
      </div>

      <template v-if="allLabels.length">
        <div class="row label-head" @click="ui.labelsOpen = !ui.labelsOpen">
          <span>{{ ui.labelsOpen ? '▾' : '▸' }} 标签筛选</span>
          <span class="badge">{{ allLabels.length }}</span>
          <span v-if="label.length" class="badge" style="color: var(--accent)">已选 {{ label.length }}</span>
          <span class="spacer" />
          <button v-if="label.length" class="ghost sm" @click.stop="label = []">清除</button>
        </div>
        <div v-if="ui.labelsOpen" class="pills label-pills">
          <span v-for="l in allLabels" :key="l" :class="['pill', { on: label.includes(l) }]" @click="toggleLabel(l)">{{ l }}</span>
        </div>
        <div v-else-if="label.length" class="pills">
          <span v-for="l in label" :key="l" class="pill on" title="点击取消" @click="toggleLabel(l)">{{ l }} ×</span>
        </div>
      </template>

      <div class="row" style="margin-top: 8px; gap: 4px; flex-wrap: wrap">
        <button class="ghost sm" @click="bulk = !bulk; sel = []">{{ bulk ? '完成' : '批量' }}</button>
        <span class="muted" style="font-size: 12px">{{ visible.length }} 组</span>
        <template v-if="bulk">
          <button class="ghost sm" @click="selectAll">全选</button>
          <span class="muted" style="font-size: 12px">已选 {{ sel.length }}</span>
        </template>
      </div>
      <div v-if="bulk && sel.length" class="row" style="margin-top: 4px; gap: 4px; flex-wrap: wrap">
        <select class="sm" @change="bulkRating(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
          <option value="">分级…</option>
          <option v-for="c in CATEGORIES" :key="c" :value="c">{{ RATING_LABEL[c] }}</option>
          <option value="NONE">未分级</option>
        </select>
        <button class="ghost sm" @click="bulkFolder">移动</button>
        <button class="ghost sm" @click="bulkLabel(true)">+标签</button>
        <button class="ghost sm" @click="bulkLabel(false)">−标签</button>
        <button class="ghost sm" :disabled="!!aiBusy" @click="bulkClassify">{{ aiBusy || '✨AI 整理' }}</button>
        <button class="ghost sm" @click="bulkMerge">合并</button>
        <button class="ghost sm" @click="emit('export', sel)">导出</button>
        <button class="ghost danger sm" @click="bulkDelete">删除</button>
      </div>
    </div>

    <div class="row density">
      <span title="缩小：只显示文字">≡</span>
      <input v-model.number="ui.cardSize" type="range" min="0" max="100" step="1" title="调整列表大小：越小越紧凑，越大图越清晰" />
      <span title="放大：大图卡片">▦</span>
    </div>
    <div :class="['side-list', mode, { 'img-only': ui.cardSize >= 85 }]" :style="listStyle">
      <template v-for="(s, i) in visible" :key="s.id">
      <div v-if="bucketAt(i)" class="date-head">{{ bucketAt(i) }}</div>
      <div
        :class="['set-item', { on: s.id === selected, picked: sel.includes(s.id) }]"
        :draggable="canDrag && !bulk" @click="!bulk && onClick(s)"
        @mousedown="bulk && ds.start($event, s.id, sel.includes(s.id), setSel)" @mouseenter="bulk && ds.over(s.id)" @dragstart="dragId = s.id; $event.dataTransfer?.setData('text/plain', s.id)" @dragend="dragId = ''"
        @dragover.prevent @drop.prevent="drop(s)">
        <input v-if="bulk" type="checkbox" :checked="sel.includes(s.id)" style="width: auto; pointer-events: none" tabindex="-1" />
        <div v-if="mode !== 'mode-list'" :class="['thumb', { multi: (s.shots?.length || 0) > 1, many: (s.shots?.length || 0) > 2 }]">
          <img v-if="s.shots?.length && imgSrc(s.shots[0].id)" :src="imgSrc(s.shots[0].id)" />
          <span v-else>{{ s.name.slice(0, 1) }}</span>
        </div>
        <div class="set-text">
          <div class="set-name" :title="s.name">
            <span v-if="s.favorite" style="color: var(--star)">★</span>{{ s.name }}
          </div>
          <div class="set-sub">
            <span v-if="s.category" :class="['rtag', 'r-' + s.category]">{{ RATING_LABEL[s.category] }}</span>
            <span v-if="s.folder" class="muted">📁{{ s.folder }}</span>
            <span class="muted">{{ s.tags.length }}词</span>
            <span v-if="s.shots?.length" class="muted">🖼{{ s.shots.length }}</span>
            <span class="muted" :title="'创建 ' + fmtDate(s.createdAt, true) + '\n修改 ' + fmtDate(s.updatedAt, true)">{{ fmtDate(s.createdAt).slice(5) }}</span>
          </div>
        </div>
      </div>
      </template>
      <p v-if="!visible.length" class="muted" style="text-align: center; margin-top: 20px">没有匹配的提示词组</p>
    </div>
  </aside>
</template>
