<script setup lang="ts">
import { useDragSelect, listSetter } from '../lib/dragSelect'
import { ref, computed } from 'vue'
import { doc, addSet, newSet, touch, removeSets, folders, createFolder, renameFolder, deleteFolder, allLabels, promptText, fmtDate, dateBucket } from '../lib/store'
import { CATEGORIES, RATING_LABEL, type Category, type PromptSet } from '../lib/types'
import { imgSrc } from '../lib/imagedb'
import { aiClassify } from '../lib/ai'
import { ui } from '../lib/ui'

const props = defineProps<{ selected: string }>()
const emit = defineEmits<{ (e: 'update:selected', id: string): void; (e: 'toast', msg: string): void; (e: 'export', ids: string[]): void }>()

// ---- filters ----
const q = ref('')
const rating = ref<'ALL' | 'NONE' | Category>('ALL')
const folder = ref('')          // current folder path, '' = root (like Windows Explorer)
const label = ref<string[]>([])
const favOnly = ref(false)
const sort = ref<'manual' | 'updated' | 'created' | 'oldest' | 'name'>('manual')
const range = ref<'' | '1' | '7' | '30' | '90'>('')   // only sets created in the last N days

const visible = computed(() => {
  const k = q.value.trim().toLowerCase()
  let list = doc.sets.filter((s) => {
    if (rating.value === 'NONE' ? s.category : rating.value !== 'ALL' && s.category !== rating.value) return false
    // searching looks inside the current folder and all its subfolders; browsing shows only this level
    if (!ui.explorer) {
      // classic view: folder dropdown filters, '' = all, '__none' = no folder
      if (folder.value === '__none' ? s.folder : folder.value && !(s.folder === folder.value || (s.folder || '').startsWith(folder.value + '/'))) return false
    } else if (k || rating.value !== 'ALL' || label.value.length || favOnly.value || range.value) {
      if (folder.value && !(s.folder === folder.value || (s.folder || '').startsWith(folder.value + '/'))) return false
    } else if ((s.folder || '') !== folder.value) return false
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
  const f = prompt('移动到文件夹（用 / 分级，留空 = 移到根目录）', folder.value === '__none' ? '' : folder.value)
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
// ---- Explorer-style folders ----
const crumbs = computed(() => {
  const parts = folder.value ? folder.value.split('/') : []
  return parts.map((p, i) => ({ name: p, path: parts.slice(0, i + 1).join('/') }))
})
const subFolders = computed(() => {
  const pre = folder.value ? folder.value + '/' : ''
  return folders.value.filter((f) => f.startsWith(pre) && f.length > pre.length && !f.slice(pre.length).includes('/'))
    .map((path) => {
      const inside = doc.sets.filter((s) => s.folder === path || (s.folder || '').startsWith(path + '/'))
      const cover = inside.find((s) => s.shots?.length)?.shots?.[0].id
      return { path, name: path.slice(pre.length), count: inside.length, cover }
    })
})
const browsing = computed(() => ui.explorer && !q.value.trim() && rating.value === 'ALL' && !label.value.length && !favOnly.value && !range.value)
function openFolder(p: string) { folder.value = p; sel.value = [] }
// ---- 🎲 random set: for "I don't know what to run" ----
// picks from what's currently visible (respects search/rating/filters; in Explorer view also subfolders)
const lastRand = ref('')
function randomSet() {
  const pre = folder.value && folder.value !== '__none' ? folder.value : ''
  let pool = ui.explorer && browsing.value
    ? doc.sets.filter((s) => !pre || s.folder === pre || (s.folder || '').startsWith(pre + '/'))
    : visible.value
  if (pool.length > 1) pool = pool.filter((s) => s.id !== lastRand.value)
  if (!pool.length) return emit('toast', '这里没有可抽的提示词组')
  // sets with result images are a bit more likely: they're proven to work
  const w = pool.map((s) => (s.shots?.length ? 2 : 1) + (s.favorite ? 1 : 0))
  let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0
  while ((r -= w[i]) > 0 && i < pool.length - 1) i++
  const s = pool[i]
  lastRand.value = s.id
  emit('update:selected', s.id)
  emit('toast', `🎲 抽到：${s.name}${s.folder ? '（📁' + s.folder + '）' : ''}，再点一次换一个`)
}
function toggleView() { ui.explorer = !ui.explorer; folder.value = '' }
function upFolder() { openFolder(folder.value.includes('/') ? folder.value.slice(0, folder.value.lastIndexOf('/')) : '') }
function newFolder() {
  const n = prompt('新建文件夹名称（可用 / 一次建多级）')
  if (!n?.trim()) return
  const p = createFolder((folder.value ? folder.value + '/' : '') + n.trim().replace(/^\/+/, ''))
  if (p) emit('toast', '已新建文件夹：' + p)
}
const fmenu = ref<{ path: string; x: number; y: number } | null>(null)
function folderMenu(e: MouseEvent, path: string) { fmenu.value = { path, x: e.clientX, y: e.clientY } }
function renameF(path: string) {
  fmenu.value = null
  const n = prompt('重命名 / 移动文件夹（完整路径，用 / 分级）', path)
  if (n === null) return
  if (!renameFolder(path, n)) return emit('toast', '名称无效或与原来相同')
  if (folder.value === path || folder.value.startsWith(path + '/')) folder.value = n.trim() + folder.value.slice(path.length)
}
function deleteF(path: string) {
  fmenu.value = null
  if (!confirm(`删除文件夹「${path}」？\n里面的提示词组不会被删，会移到上一级。`)) return
  deleteFolder(path)
}
// drop a set (or the selected sets in bulk mode) onto a folder tile / breadcrumb
const fHover = ref('')
function dropOnFolder(path: string) {
  fHover.value = ''
  const ids = bulk.value && sel.value.length ? sel.value : dragId.value ? [dragId.value] : []
  dragId.value = ''
  let n = 0
  for (const s of doc.sets) if (ids.includes(s.id) && (s.folder || '') !== path) { s.folder = path || undefined; touch(s); n++ }
  if (n) emit('toast', `已移动 ${n} 组到 ${path || '根目录'}`)
}

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
        <select v-if="!ui.explorer" v-model="folder" style="flex: 1; min-width: 0">
          <option value="">📁 全部文件夹</option>
          <option value="__none">（无文件夹）</option>
          <option v-for="f in folders" :key="f" :value="f">{{ f }}</option>
        </select>
        <button class="ghost" :title="ui.explorer ? '切换到经典列表（文件夹下拉筛选）' : '切换到资源管理器式文件夹'" @click="toggleView">{{ ui.explorer ? '🗂' : '≣' }}</button>
        <select v-model="sort" style="flex: 1; min-width: 0" title="排序">
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
        <button class="ghost" title="随机抽一组提示词（不知道跑什么时点一下；按当前筛选范围抽，有返图/收藏的更容易抽到）" @click="randomSet">🎲</button>
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
    <div v-if="ui.explorer" class="crumbs" @click="fmenu = null">
      <button class="ghost sm" :disabled="!folder" title="上一级" @click="upFolder">↑</button>
      <span :class="['crumb', { hover: fHover === '/' }]" @click="openFolder('')"
        @dragover.prevent="fHover = '/'" @dragleave="fHover = ''" @drop.prevent="dropOnFolder('')">🏠 全部</span>
      <template v-for="c in crumbs" :key="c.path">
        <span class="muted">›</span>
        <span :class="['crumb', { hover: fHover === c.path }]" :title="c.path" @click="openFolder(c.path)"
          @dragover.prevent="fHover = c.path" @dragleave="fHover = ''" @drop.prevent="dropOnFolder(c.path)">{{ c.name }}</span>
      </template>
      <span class="spacer" />
      <button class="ghost sm" title="在这里新建文件夹" @click="newFolder">＋📁</button>
    </div>
    <div :class="['side-list', mode, { 'img-only': ui.cardSize >= 85 }]" :style="listStyle" @click="fmenu = null">
      <template v-if="browsing">
        <div v-for="f in subFolders" :key="f.path" :class="['set-item', 'folder-item', { hover: fHover === f.path }]" :title="f.path"
          @click="openFolder(f.path)" @contextmenu.prevent="folderMenu($event, f.path)"
          @dragover.prevent="fHover = f.path" @dragleave="fHover = ''" @drop.prevent.stop="dropOnFolder(f.path)">
          <div v-if="mode !== 'mode-list'" class="thumb folder-thumb">
            <img v-if="f.cover && imgSrc(f.cover)" :src="imgSrc(f.cover)" />
            <span class="folder-ico">📁</span>
          </div>
          <div class="set-text">
            <div class="set-name"><span v-if="mode === 'mode-list'">📁 </span>{{ f.name }}</div>
            <div class="set-sub"><span class="muted">{{ f.count }} 组</span></div>
          </div>
          <button class="ghost sm folder-more" title="重命名 / 删除" @click.stop="folderMenu($event, f.path)">⋯</button>
        </div>
      </template>
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
      <p v-if="!visible.length && !(browsing && subFolders.length)" class="muted" style="text-align: center; margin-top: 20px">{{ browsing ? (folder ? "这个文件夹是空的，可以把提示词组拖到上面的路径或文件夹里" : "还没有提示词组") : "没有匹配的提示词组" }}</p>
    </div>
    <div v-if="fmenu" class="ctx-menu" :style="{ left: fmenu.x + 'px', top: fmenu.y + 'px' }">
      <button class="ghost" @click="openFolder(fmenu.path); fmenu = null">打开</button>
      <button class="ghost" @click="renameF(fmenu.path)">重命名 / 移动</button>
      <button class="ghost danger" @click="deleteF(fmenu.path)">删除文件夹</button>
    </div>
  </aside>
</template>
