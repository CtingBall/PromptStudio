<script setup lang="ts">
import { useSelection, useMarquee, FK, isFolderKey, folderOf, freeName } from '../lib/explorer'
import { ref, computed, watch, nextTick } from 'vue'
import { doc, addSet, newSet, touch, removeSets, duplicateSet, folders, createFolder, renameFolder, deleteFolder, allLabels, promptText, fmtDate, dateBucket } from '../lib/store'
import { CATEGORIES, RATING_LABEL, FORMAT_LABEL, type Category, type PromptSet } from '../lib/types'
import { promptFormat } from '../lib/tags'
import { imgSrc } from '../lib/imagedb'
import { genInfo } from '../lib/pngmeta'
import LayoutMini from './LayoutMini.vue'
import { aiClassify } from '../lib/ai'
import { ui } from '../lib/ui'
import Icon from './Icon.vue'
import { setStatus, STATUS_INFO, STATUS_ORDER, markUsed, isNew, type SetStatus } from '../lib/usage'

const props = defineProps<{ selected: string }>()
const emit = defineEmits<{ (e: 'update:selected', id: string): void; (e: 'toast', msg: string): void; (e: 'export', ids: string[]): void }>()

// ---- filters ----
const q = ref('')
const rating = ref<'ALL' | 'NONE' | Category>('ALL')
const folder = ref('')          // current folder path, '' = root (like Windows Explorer)
const label = ref<string[]>([])
const favOnly = ref(false)
const layoutOnly = ref(false)   // only sets that have a bbox layout
const shotsOnly = ref(false)    // only sets that have result images
const status = ref<'' | SetStatus>('')   // 未看 / 看过 / 跑过 / 已出图
const statusCount = (st: SetStatus) => doc.sets.filter((s) => setStatus(s) === st).length
const hasLayout = (s: PromptSet) => !!s.regions?.length
// image overlays (format / layout) only once cards are big enough to read them
const overlay = computed(() => ui.cardSize >= 55)
const fmtIcon: Record<string, string> = { tags: '🏷', natural: '📝', mixed: '🏷📝', gbc: '🕸' }
// model / LoRA names used by a set's result images (for search + list hint)
function setModels(s: PromptSet): string[] {
  const out = new Set<string>()
  for (const x of s.shots || []) { const i = genInfo(x.meta); if (i?.model) out.add(i.model); i?.loras.forEach((l) => out.add(l.name)) }
  return [...out]
}
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
    } else if (k || rating.value !== 'ALL' || label.value.length || favOnly.value || range.value || layoutOnly.value || shotsOnly.value || status.value) {
      if (folder.value && !(s.folder === folder.value || (s.folder || '').startsWith(folder.value + '/'))) return false
    } else if ((s.folder || '') !== folder.value) return false
    if (label.value.length && !label.value.every((l) => s.labels?.includes(l))) return false
    if (favOnly.value && !s.favorite) return false
    if (layoutOnly.value && !hasLayout(s)) return false
    if (shotsOnly.value && !s.shots?.length) return false
    if (status.value && setStatus(s) !== status.value) return false
    if (range.value && s.createdAt < Date.now() - Number(range.value) * 86400000) return false
    if (k) {
      const hay = [s.name, fmtDate(s.createdAt), s.folder, ...(s.labels || []), ...setModels(s), ...(s.regions || []).map((r) => r.text), ...s.tags.map((t) => t.en + ' ' + t.zh)].join(' ').toLowerCase()
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
  status.value = ''
  const s = addSet()
  if (rating.value !== 'ALL' && rating.value !== 'NONE') s.category = rating.value
  if (folder.value && folder.value !== '__none') s.folder = folder.value
  emit('update:selected', s.id)
}

// ---- Explorer-style folders + selection (click / Ctrl / Shift / marquee / keyboard) ----
const bulk = ref(false)   // shows checkboxes; selection itself always works
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
const browsing = computed(() => ui.explorer && !q.value.trim() && rating.value === 'ALL' && !label.value.length && !favOnly.value && !range.value && !layoutOnly.value && !shotsOnly.value && !status.value)
const shownFolders = computed(() => (browsing.value ? subFolders.value : []))
const order = () => [...shownFolders.value.map((f) => FK + f.path), ...visible.value.map((s) => s.id)]
const S = useSelection(order)
const sel = computed(() => S.sel.value.filter((k) => !isFolderKey(k)))          // selected set ids
const selFolders = computed(() => S.sel.value.filter(isFolderKey).map(folderOf))
const selSets = () => doc.sets.filter((s) => sel.value.includes(s.id))
watch([visible, shownFolders], () => S.prune())
const listEl = ref<HTMLElement | null>(null)
function focusList() { nextTick(() => listEl.value?.focus({ preventScroll: true })) }
function clearFilters() {
  q.value = ''; rating.value = 'ALL'; label.value = []; favOnly.value = false
  range.value = ''; layoutOnly.value = false; shotsOnly.value = false; status.value = ''
}

// folder navigation with back / forward history (mouse side buttons, Alt+←/→)
const back = ref<string[]>([])
const fwd = ref<string[]>([])
function openFolder(p: string, hist = true) {
  if (p === folder.value) return
  const from = folder.value
  if (hist) { back.value.push(from); fwd.value = [] }
  folder.value = p
  // going up selects the folder you came from, like Explorer
  const child = from.startsWith(p ? p + '/' : '') && from !== p ? (p ? p + '/' : '') + from.slice(p ? p.length + 1 : 0).split('/')[0] : ''
  if (child) nextTick(() => { S.set([FK + child]); scrollTo(FK + child) })
  else S.clear()
  focusList()
}
function goBack() { const p = back.value.pop(); if (p === undefined) return; fwd.value.push(folder.value); openFolder(p, false) }
function goFwd() { const p = fwd.value.pop(); if (p === undefined) return; back.value.push(folder.value); openFolder(p, false) }
function upFolder() { if (folder.value) openFolder(folder.value.includes('/') ? folder.value.slice(0, folder.value.lastIndexOf('/')) : '') }
function toggleView() { ui.explorer = !ui.explorer; folder.value = ''; back.value = []; fwd.value = []; S.clear(); markUsed('explorer') }
function scrollTo(k: string) { listEl.value?.querySelector(`[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ block: 'nearest' }) }
// ---- item clicks ----
function itemClick(e: MouseEvent, k: string) {
  if (bulk.value && !e.shiftKey) { S.toggle(k); S.anchor.value = k; return }
  const plain = S.click(e, k)
  if (plain && !isFolderKey(k)) emit('update:selected', k)
}
function itemDbl(k: string) { if (isFolderKey(k)) openFolder(folderOf(k)) }
function onSel(keys: string[]) { S.sel.value = keys }
const mq = useMarquee(listEl, onSel)

// ---- bulk ops on selected sets ----
function bulkRating(c: string) {
  for (const s of selSets()) { s.category = c === 'NONE' ? undefined : (c as Category); touch(s) }
}
function moveSets(ids: string[], path: string) {
  let n = 0
  for (const s of doc.sets) if (ids.includes(s.id) && (s.folder || '') !== path) { s.folder = path || undefined; touch(s); n++ }
  return n
}
function moveFolders(paths: string[], target: string) {
  let n = 0
  for (const p of paths) {
    const name = p.slice(p.lastIndexOf('/') + 1)
    const to = (target ? target + '/' : '') + name
    if (to === p || target === p || target.startsWith(p + '/')) continue
    if (renameFolder(p, to)) n++
  }
  return n
}
function bulkFolder() {
  const f = prompt('移动到文件夹（用 / 分级，留空 = 移到根目录）', folder.value === '__none' ? '' : folder.value)
  if (f === null) return
  const t = f.split('/').map((x) => x.trim()).filter(Boolean).join('/')
  const n = moveSets(sel.value, t) + moveFolders(selFolders.value, t)
  emit('toast', `已移动 ${n} 项到 ${t || '根目录'}`)
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
function deleteSelected() {
  const ids = sel.value, fs = selFolders.value
  if (!ids.length && !fs.length) return
  const parts = [ids.length ? `${ids.length} 个提示词组（含返图）` : '', fs.length ? `${fs.length} 个文件夹（里面的组会移到上一级，不会删除）` : ''].filter(Boolean)
  if (!confirm('删除 ' + parts.join(' 和 ') + '？')) return
  if (ids.length) removeSets(ids)
  for (const f of [...fs].sort((a, b) => b.length - a.length)) deleteFolder(f)
  if (!doc.sets.some((s) => s.id === props.selected)) emit('update:selected', doc.sets[0]?.id || '')
  S.clear()
  emit('toast', '已删除 ' + parts.map((p) => p.replace(/（.*）/, '')).join('、'))
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
  S.set([s.id])
  emit('toast', `已合并 ${list.length} 组`)
}
// ---- new folder / inline rename ----
const renaming = ref('')       // key being renamed (folder key or set id)
const renameText = ref('')
function newFolder() {
  const parent = ui.explorer && folder.value !== '__none' ? folder.value : ''
  if (!ui.explorer) { ui.explorer = true; folder.value = '' }
  clearFilters()
  const p = createFolder((parent ? parent + '/' : '') + freeName(folders.value, parent))
  if (!p) return
  markUsed('explorer')
  nextTick(() => { S.set([FK + p]); scrollTo(FK + p); startRename(FK + p) })
}
function startRename(k: string) {
  renaming.value = k
  renameText.value = isFolderKey(k) ? folderOf(k).split('/').pop()! : doc.sets.find((s) => s.id === k)?.name || ''
  nextTick(() => { const el = listEl.value?.querySelector<HTMLInputElement>('.rename-input'); el?.focus(); el?.select() })
}
function commitRename() {
  const k = renaming.value
  if (!k) return
  renaming.value = ''
  const n = renameText.value.trim().replace(/\//g, '／')
  if (!n) return focusList()
  if (isFolderKey(k)) {
    const p = folderOf(k)
    const to = (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '') + n
    if (to !== p) {
      if (folders.value.includes(to)) emit('toast', '这里已经有同名文件夹了')
      else if (renameFolder(p, to)) S.set([FK + to])
    }
  } else {
    const s = doc.sets.find((x) => x.id === k)
    if (s && s.name !== n) { s.name = n; touch(s) }
  }
  focusList()
}
function cancelRename() { renaming.value = ''; focusList() }

// ---- cut / copy / paste (Ctrl+X / C / V) ----
const clip = ref<{ mode: 'cut' | 'copy'; keys: string[] } | null>(null)
const isCut = (k: string) => clip.value?.mode === 'cut' && clip.value.keys.includes(k)
function cut() { if (S.sel.value.length) { clip.value = { mode: 'cut', keys: [...S.sel.value] }; emit('toast', `已剪切 ${S.sel.value.length} 项，到目标文件夹按 Ctrl+V 粘贴`) } }
function copy() {
  if (!sel.value.length) return emit('toast', '文件夹不能复制，只能剪切移动')
  clip.value = { mode: 'copy', keys: [...sel.value] }
  emit('toast', `已复制 ${sel.value.length} 组，按 Ctrl+V 粘贴副本`)
}
function paste(target = ui.explorer ? folder.value : '') {
  const c = clip.value
  if (!c) return
  const ids = c.keys.filter((k) => !isFolderKey(k)), fs = c.keys.filter(isFolderKey).map(folderOf)
  if (c.mode === 'cut') {
    const n = moveSets(ids, target) + moveFolders(fs, target)
    clip.value = null
    emit('toast', n ? `已移动 ${n} 项到 ${target || '根目录'}` : '已经在这个文件夹里了')
  } else {
    const made: string[] = []
    for (const id of ids) { const d = duplicateSet(id); if (d) { d.folder = target || undefined; made.push(d.id) } }
    S.set(made)
    emit('toast', `已粘贴 ${made.length} 个副本`)
  }
}
function duplicateSel() { if (sel.value.length) { clip.value = { mode: 'copy', keys: [...sel.value] }; paste(ui.explorer ? folder.value : ''); clip.value = null } }
// ---- 🍡 random set ----
const lastRand = ref('')
function randomSet() {
  markUsed('random')
  const pre = folder.value && folder.value !== '__none' ? folder.value : ''
  let pool = ui.explorer && browsing.value
    ? doc.sets.filter((s) => !pre || s.folder === pre || (s.folder || '').startsWith(pre + '/'))
    : visible.value
  if (pool.length > 1) pool = pool.filter((s) => s.id !== lastRand.value)
  if (!pool.length) return emit('toast', '这里没有可抽的提示词组')
  const w = pool.map((s) => (s.shots?.length ? 2 : 1) + (s.favorite ? 1 : 0))
  let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0
  while ((r -= w[i]) > 0 && i < pool.length - 1) i++
  const s = pool[i]
  lastRand.value = s.id
  emit('update:selected', s.id)
  emit('toast', `🍡 抽到：${s.name}${s.folder ? '（📁' + s.folder + '）' : ''}，再点一次换一个`)
}

// ---- drag & drop: reorder sets (manual sort) or move items into folders ----
const dragKeys = ref<string[]>([])
const canDrag = computed(() => sort.value === 'manual')
const fHover = ref('')
function dragStart(e: DragEvent, k: string) {
  if (!S.has(k)) S.click({ shiftKey: false, ctrlKey: false, metaKey: false }, k)
  dragKeys.value = [...S.sel.value]
  e.dataTransfer?.setData('text/plain', dragKeys.value.join(','))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  // custom drag image showing how many items move
  if (dragKeys.value.length > 1 && e.dataTransfer) {
    const g = document.createElement('div'); g.className = 'drag-ghost'; g.textContent = `移动 ${dragKeys.value.length} 项`
    document.body.appendChild(g); e.dataTransfer.setDragImage(g, 10, 10); setTimeout(() => g.remove())
  }
}
function dragEnd() { dragKeys.value = []; fHover.value = '' }
function dropOnFolder(path: string) {
  fHover.value = ''
  const ks = dragKeys.value
  dragKeys.value = []
  const fs = ks.filter(isFolderKey).map(folderOf).filter((f) => f !== path)
  const n = moveSets(ks.filter((k) => !isFolderKey(k)), path) + moveFolders(fs, path)
  if (n) emit('toast', `已移动 ${n} 项到 ${path || '根目录'}`)
}
function dropOnSet(t: PromptSet) {
  const ids = dragKeys.value.filter((k) => !isFolderKey(k) && k !== t.id)
  dragKeys.value = []
  if (!ids.length || !canDrag.value) return
  const moving = doc.sets.filter((s) => ids.includes(s.id))
  const rest = doc.sets.filter((s) => !ids.includes(s.id))
  const at = rest.findIndex((s) => s.id === t.id)
  rest.splice(at < 0 ? rest.length : at, 0, ...moving)
  doc.sets = rest
}
// ---- keyboard (list has focus) ----
function cols(): number {
  // items per row in card mode, for ↑/↓
  const items = listEl.value?.querySelectorAll<HTMLElement>('[data-key]')
  if (!items || items.length < 2 || mode.value !== 'mode-card') return 1
  const top = items[0].offsetTop
  let n = 0
  for (const it of items) { if (it.offsetTop !== top) break; n++ }
  return Math.max(1, n)
}
function moveTo(d: number, shift: boolean) {
  const k = S.move(d, shift)
  if (!k) return
  scrollTo(k)
  if (!shift && !isFolderKey(k)) emit('update:selected', k)
}
function onListKey(e: KeyboardEvent) {
  if (renaming.value || (e.target as HTMLElement).closest('input, textarea, select')) return
  const ctrl = e.ctrlKey || e.metaKey, k = e.key
  const go = (fn: () => void) => { e.preventDefault(); fn() }
  if (e.altKey && k === 'ArrowLeft') return go(goBack)
  if (e.altKey && k === 'ArrowRight') return go(goFwd)
  if (e.altKey && k === 'ArrowUp') return go(upFolder)
  if (k === 'ArrowDown') return go(() => moveTo(cols(), e.shiftKey))
  if (k === 'ArrowUp') return go(() => moveTo(-cols(), e.shiftKey))
  if (k === 'ArrowRight' && cols() > 1) return go(() => moveTo(1, e.shiftKey))
  if (k === 'ArrowLeft' && cols() > 1) return go(() => moveTo(-1, e.shiftKey))
  if (k === 'Home') return go(() => moveTo(-1e9, e.shiftKey))
  if (k === 'End') return go(() => moveTo(1e9, e.shiftKey))
  if (k === 'Enter') return go(() => { const f = S.focus.value; if (f) isFolderKey(f) ? openFolder(folderOf(f)) : emit('update:selected', f) })
  if (k === 'Backspace') return go(goBack)
  if (k === 'F2') return go(() => { const f = S.focus.value || S.sel.value[0]; if (f) startRename(f) })
  if (k === 'Delete') return go(deleteSelected)
  if (k === 'Escape') return go(() => { S.clear(); clip.value = null })
  if (ctrl && e.shiftKey && k.toLowerCase() === 'n') return go(newFolder)
  if (!ctrl) return
  const c = k.toLowerCase()
  if (c === 'a') return go(S.all)
  if (c === 'x') return go(cut)
  if (c === 'c') return go(copy)
  if (c === 'v') return go(() => paste())
  if (c === 'd') return go(duplicateSel)
}
// mouse side buttons = back / forward (like Explorer)
function onAux(e: PointerEvent) {
  if (e.button === 3) { e.preventDefault(); goBack() }
  if (e.button === 4) { e.preventDefault(); goFwd() }
}
function onListDown(e: PointerEvent) {
  if (e.button === 3 || e.button === 4) return onAux(e)
  ctx.value = null
  mq.start(e, S.sel.value)
}

// ---- right-click menu ----
const ctx = ref<{ x: number; y: number; k: string } | null>(null)
function openCtx(e: MouseEvent, k = '') {
  e.preventDefault()
  if (k && !S.has(k)) S.click({ shiftKey: false, ctrlKey: false, metaKey: false }, k)
  if (!k) S.clear()
  ctx.value = { x: Math.min(e.clientX, innerWidth - 190), y: Math.min(e.clientY, innerHeight - 300), k }
}
function ctxDo(fn: () => void) { ctx.value = null; fn(); focusList() }
function ctxOpen() { const k = ctx.value?.k; if (k) isFolderKey(k) ? openFolder(folderOf(k)) : emit('update:selected', k) }
function newSetHere() { create() }
// ==SB-6==
</script>

<template>
  <aside class="side" data-tour="library">
    <div class="side-top">
      <div class="row" style="gap: 6px">
        <button class="primary" style="flex: 1" @click="create"><Icon name="plus" /> 新建提示词组</button>
        <button class="ghost icon-btn" title="随机抽一组提示词（不知道跑什么时点一下；按当前筛选范围抽，有返图/收藏的更容易抽到）" @click="randomSet"><Icon name="dango" /><i v-if="isNew('random')" class="dot" /></button>
      </div>
      <div class="search-box"><Icon name="search" /><input v-model="q" placeholder="搜索名称 / 标签 / 中英文词 / 模型" /></div>

      <div class="status-row" data-tour="status">
        <button v-for="st in STATUS_ORDER" :key="st" :class="['st-btn', 'st-' + st, { on: status === st }]" :title="STATUS_INFO[st].hint + '（点击只看这一类）'"
          @click="status = status === st ? '' : st"><Icon :name="STATUS_INFO[st].icon" />{{ STATUS_INFO[st].label }}<small>{{ statusCount(st) }}</small></button>
      </div>

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
        <button class="ghost icon-btn" :title="ui.explorer ? '切换到经典列表（文件夹下拉筛选）' : '切换到资源管理器式文件夹'" @click="toggleView"><Icon :name="ui.explorer ? 'folder' : 'layers'" /></button>
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
                <button :class="['icon-btn', favOnly ? 'on' : 'ghost']" title="只看收藏" @click="favOnly = !favOnly"><Icon name="star" /></button>
        <button :class="['icon-btn', layoutOnly ? 'on' : 'ghost']" title="只看有画框布局的组" @click="layoutOnly = !layoutOnly"><Icon name="ruler" /></button>
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
        <button :class="['sm', bulk ? 'on' : 'ghost']" title="显示勾选框（不开也能 Ctrl / Shift 多选、拖框选）" @click="bulk = !bulk; markUsed('bulk')"><Icon name="checklist" /> {{ bulk ? '完成' : '勾选' }}</button>
        <button class="ghost sm" title="全选（Ctrl+A）" @click="S.all()">全选</button>
        <button v-if="S.sel.value.length" class="ghost sm" title="取消选择（Esc）" @click="S.clear()">取消</button>
      </div>
      <div v-if="sel.length || selFolders.length" class="row sel-bar" style="margin-top: 4px; gap: 4px; flex-wrap: wrap">
        <select v-if="sel.length" class="sm" @change="bulkRating(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
          <option value="">分级…</option>
          <option v-for="c in CATEGORIES" :key="c" :value="c">{{ RATING_LABEL[c] }}</option>
          <option value="NONE">未分级</option>
        </select>
        <button class="ghost sm" title="移动到文件夹（也可以剪切 Ctrl+X 再到目标处粘贴 Ctrl+V，或直接拖到文件夹上）" @click="bulkFolder">移动</button>
        <template v-if="sel.length">
          <button class="ghost sm" @click="bulkLabel(true)">+标签</button>
          <button class="ghost sm" @click="bulkLabel(false)">−标签</button>
          <button class="ghost sm" :disabled="!!aiBusy" @click="bulkClassify">{{ aiBusy || '✨AI 整理' }}</button>
          <button v-if="sel.length > 1" class="ghost sm" @click="bulkMerge">合并</button>
          <button class="ghost sm" @click="emit('export', sel)">导出</button>
        </template>
        <button class="ghost danger sm" title="Delete" @click="deleteSelected">删除</button>
      </div>
    </div>

    <div class="row density">
      <span title="缩小：只显示文字">≡</span>
      <input v-model.number="ui.cardSize" type="range" min="0" max="100" step="1" title="调整列表大小：越小越紧凑，越大图越清晰" />
      <span title="放大：大图卡片">▦</span>
    </div>
    <div v-if="ui.explorer" class="crumbs">
      <button class="ghost sm nav-btn" :disabled="!back.length" title="后退（Alt+← / Backspace / 鼠标侧键）" @click="goBack">←</button>
      <button class="ghost sm nav-btn" :disabled="!fwd.length" title="前进（Alt+→）" @click="goFwd">→</button>
      <button class="ghost sm nav-btn" :disabled="!folder" title="上一级（Alt+↑）" @click="upFolder">↑</button>
      <div class="crumb-path">
        <span :class="['crumb', { hover: fHover === '/' }]" @click="openFolder('')"
          @dragover.prevent="fHover = '/'" @dragleave="fHover = ''" @drop.prevent="dropOnFolder('')">🏠 全部</span>
        <template v-for="c in crumbs" :key="c.path">
          <span class="muted">›</span>
          <span :class="['crumb', { hover: fHover === c.path }]" :title="c.path" @click="openFolder(c.path)"
            @dragover.prevent="fHover = c.path" @dragleave="fHover = ''" @drop.prevent="dropOnFolder(c.path)">{{ c.name }}</span>
        </template>
      </div>
      <button class="ghost sm" title="新建文件夹（Ctrl+Shift+N）" @click="newFolder">＋<Icon name="folder" /></button>
    </div>
    <div v-else class="crumbs">
      <span class="muted" style="font-size: 12px">经典列表</span>
      <span class="spacer" />
      <button class="ghost sm" title="新建文件夹（会切到资源管理器视图）" @click="newFolder">＋<Icon name="folder" /></button>
    </div>
    <div ref="listEl" :class="['side-list', mode, { 'img-only': ui.cardSize >= 85 }]" :style="listStyle" tabindex="0"
      @keydown="onListKey" @pointerdown="onListDown" @contextmenu.self="openCtx($event)" @auxclick.prevent>
      <div v-for="f in shownFolders" :key="f.path" :data-key="FK + f.path"
        :class="['set-item', 'folder-item', { hover: fHover === f.path, picked: S.has(FK + f.path), focus: S.focus.value === FK + f.path, cut: isCut(FK + f.path) }]"
        :title="f.path + '（双击打开）'" draggable="true"
        @click="itemClick($event, FK + f.path)" @dblclick="itemDbl(FK + f.path)" @contextmenu.prevent="openCtx($event, FK + f.path)"
        @dragstart="dragStart($event, FK + f.path)" @dragend="dragEnd"
        @dragover.prevent="fHover = f.path" @dragleave="fHover = ''" @drop.prevent.stop="dropOnFolder(f.path)">
        <input v-if="bulk" type="checkbox" :checked="S.has(FK + f.path)" style="width: auto; pointer-events: none" tabindex="-1" />
        <div v-if="mode !== 'mode-list'" class="thumb folder-thumb">
          <img v-if="f.cover && imgSrc(f.cover)" :src="imgSrc(f.cover)" />
          <span class="folder-ico">📁</span>
        </div>
        <div class="set-text">
          <input v-if="renaming === FK + f.path" v-model="renameText" class="rename-input"
            @keydown.enter.stop.prevent="commitRename" @keydown.esc.stop.prevent="cancelRename" @blur="commitRename" @click.stop @pointerdown.stop />
          <div v-else class="set-name"><span v-if="mode === 'mode-list'">📁 </span>{{ f.name }}</div>
          <div class="set-sub"><span class="muted">{{ f.count ? f.count + ' 组' : '空文件夹' }}</span></div>
        </div>
      </div>
      <template v-for="(s, i) in visible" :key="s.id">
      <div v-if="bucketAt(i)" class="date-head">{{ bucketAt(i) }}</div>
      <div :data-key="s.id"
        :class="['set-item', { on: s.id === selected, picked: S.has(s.id), focus: S.focus.value === s.id, cut: isCut(s.id) }]"
        draggable="true" @click="itemClick($event, s.id)" @dblclick="startRename(s.id)" @contextmenu.prevent="openCtx($event, s.id)"
        @dragstart="dragStart($event, s.id)" @dragend="dragEnd" @dragover.prevent @drop.prevent="dropOnSet(s)">
        <input v-if="bulk" type="checkbox" :checked="S.has(s.id)" style="width: auto; pointer-events: none" tabindex="-1" />
        <div v-if="mode !== 'mode-list'" :class="['thumb', { multi: (s.shots?.length || 0) > 1, many: (s.shots?.length || 0) > 2 }]">
          <img v-if="s.shots?.length && imgSrc(s.shots[0].id)" :src="imgSrc(s.shots[0].id)" draggable="false" />
          <LayoutMini v-else-if="hasLayout(s)" :set="s" :size="mode === 'mode-row' ? 40 : 120" class="thumb-layout" />
          <span v-else>{{ s.name.slice(0, 1) }}</span>
          <LayoutMini v-if="hasLayout(s) && s.shots?.length && mode !== 'mode-row'" :set="s" :size="34" class="thumb-corner" />
          <span v-if="setStatus(s) === 'new'" class="ov ov-new">NEW</span>
          <template v-if="overlay">
            <span :class="['ov', 'ov-fmt', 'f-' + promptFormat(s.tags)]" :title="'提示词写法：' + FORMAT_LABEL[promptFormat(s.tags)]">{{ fmtIcon[promptFormat(s.tags)] }} {{ FORMAT_LABEL[promptFormat(s.tags)] }}</span>
            <span v-if="hasLayout(s)" class="ov ov-layout" :title="s.regions!.length + ' 个框' + (s.canvas ? '，' + s.canvas.w + '×' + s.canvas.h : '')">▦ 画框 {{ s.regions!.length }}</span>
            <span v-if="s.category" :class="['ov', 'ov-rate', 'r-' + s.category]">{{ RATING_LABEL[s.category] }}</span>
          </template>
        </div>
        <div class="set-text">
          <input v-if="renaming === s.id" v-model="renameText" class="rename-input"
            @keydown.enter.stop.prevent="commitRename" @keydown.esc.stop.prevent="cancelRename" @blur="commitRename" @click.stop @pointerdown.stop />
          <div v-else class="set-name" :title="s.name + '（双击 / F2 重命名）'">
            <span :class="['st-dot', 'st-' + setStatus(s)]" :title="STATUS_INFO[setStatus(s)].label + '：' + STATUS_INFO[setStatus(s)].hint" />
            <span v-if="s.favorite" style="color: var(--star)">★</span>{{ s.name }}
          </div>
          <div class="set-sub">
            <span v-if="s.category" :class="['rtag', 'r-' + s.category]">{{ RATING_LABEL[s.category] }}</span>
            <span v-if="s.folder && !browsing" class="muted">📁{{ s.folder }}</span>
            <span class="muted">{{ s.tags.length }}词</span>
            <span v-if="hasLayout(s)" class="layout-tag" :title="s.regions!.length + ' 个框' + (s.canvas ? '，' + s.canvas.w + '×' + s.canvas.h : '')">▦ {{ s.regions!.length }}框</span>
            <span v-if="s.shots?.length" class="muted">🖼{{ s.shots.length }}</span>
            <span v-if="setModels(s).length && mode !== 'mode-list'" class="muted model-hint" :title="setModels(s).join('\n')">🧠{{ setModels(s)[0] }}<template v-if="setModels(s).length > 1"> +{{ setModels(s).length - 1 }}</template></span>
            <span class="muted" :title="'创建 ' + fmtDate(s.createdAt, true) + '\n修改 ' + fmtDate(s.updatedAt, true)">{{ fmtDate(s.createdAt).slice(5) }}</span>
          </div>
        </div>
      </div>
      </template>
      <p v-if="!visible.length && !shownFolders.length" class="muted empty-hint" @contextmenu.prevent="openCtx($event)">{{ browsing ? (folder ? '这个文件夹是空的。可以把提示词组拖进来，或右键新建。' : '还没有提示词组') : '没有匹配的提示词组' }}</p>
      <div v-if="mq.rect.value" class="marquee" :style="{ left: mq.rect.value.x + 'px', top: mq.rect.value.y + 'px', width: mq.rect.value.w + 'px', height: mq.rect.value.h + 'px' }" />
    </div>
    <div class="status-bar">
      <span>{{ shownFolders.length ? shownFolders.length + ' 个文件夹，' : '' }}{{ visible.length }} 组</span>
      <span v-if="S.sel.value.length" class="sel-n">已选 {{ S.sel.value.length }} 项</span>
      <span v-if="clip" class="muted">{{ clip.mode === 'cut' ? '已剪切' : '已复制' }} {{ clip.keys.length }} 项</span>
      <span class="spacer" />
      <span class="muted kb-hint" title="单击选中 · Ctrl+单击 加选 · Shift+单击 连选 · 空白处拖动 框选 · 双击文件夹 打开 · F2 重命名 · Delete 删除 · Ctrl+X/C/V 剪切/复制/粘贴 · Ctrl+D 创建副本 · Ctrl+A 全选 · Ctrl+Shift+N 新建文件夹 · Alt+←/→/↑ 后退/前进/上一级">⌨ 快捷键</span>
    </div>
    <Teleport to="body">
      <div v-if="ctx" class="ctx-backdrop" @pointerdown="ctx = null" @contextmenu.prevent="ctx = null" />
      <div v-if="ctx" class="ctx-menu" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }">
        <template v-if="ctx.k">
          <button v-if="S.sel.value.length === 1" class="ghost" @click="ctxDo(ctxOpen)">打开<kbd>Enter</kbd></button>
          <button v-if="S.sel.value.length === 1" class="ghost" @click="ctxDo(() => startRename(ctx!.k))">重命名<kbd>F2</kbd></button>
          <hr />
          <button class="ghost" @click="ctxDo(cut)">剪切<kbd>Ctrl+X</kbd></button>
          <button v-if="sel.length" class="ghost" @click="ctxDo(copy)">复制<kbd>Ctrl+C</kbd></button>
          <button v-if="clip && isFolderKey(ctx.k) && S.sel.value.length === 1" class="ghost" @click="ctxDo(() => paste(folderOf(ctx!.k)))">粘贴到这个文件夹</button>
          <button v-if="sel.length" class="ghost" @click="ctxDo(duplicateSel)">创建副本<kbd>Ctrl+D</kbd></button>
          <button class="ghost" @click="ctxDo(bulkFolder)">移动到…</button>
          <button v-if="sel.length" class="ghost" @click="ctxDo(() => emit('export', sel))">导出</button>
          <hr />
          <button class="ghost danger" @click="ctxDo(deleteSelected)">删除<kbd>Delete</kbd></button>
        </template>
        <template v-else>
          <button class="ghost" @click="ctxDo(newFolder)">新建文件夹<kbd>Ctrl+Shift+N</kbd></button>
          <button class="ghost" @click="ctxDo(newSetHere)">新建提示词组</button>
          <hr />
          <button class="ghost" :disabled="!clip" @click="ctxDo(() => paste())">粘贴<kbd>Ctrl+V</kbd></button>
          <button class="ghost" @click="ctxDo(S.all)">全选<kbd>Ctrl+A</kbd></button>
          <button v-if="ui.explorer && folder" class="ghost" @click="ctxDo(upFolder)">返回上一级<kbd>Alt+↑</kbd></button>
        </template>
      </div>
    </Teleport>
  </aside>
</template>
