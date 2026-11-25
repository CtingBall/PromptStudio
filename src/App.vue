<script setup lang="ts">
import { useDragSelect } from './lib/dragSelect'
import { ref, computed, watch, onMounted } from 'vue'
import { autoBackupOnUpdate, backupAll, APP_VERSION, IS_DESKTOP } from './lib/autobackup'
import { ui, THEMES, dragSplit, clampW } from './lib/ui'
import TagChip from './components/TagChip.vue'
import GenerateDialog from './components/GenerateDialog.vue'
import Sidebar from './components/Sidebar.vue'
import Gallery from './components/Gallery.vue'
import AiTools from './components/AiTools.vue'
import TransferDialog from './components/TransferDialog.vue'
import Credits from './components/Credits.vue'
import ShareDialog from './components/ShareDialog.vue'
import {
  doc, removeSet, duplicateSet, touch, addTag, removeTag,
  promptText, remember, settings, newSet, buildTags, folders,
} from './lib/store'
import { translateTags } from './lib/translate'
import { chat } from './lib/grok'
import { tagsFromPrompt, groupTags } from './lib/tags'
import { lookup, snapshot, fmtDate } from './lib/store'
import HistoryDialog from './components/HistoryDialog.vue'
import ManualDialog from './components/ManualDialog.vue'
import { AI_TASKS, type AiTask } from './lib/types'
import { markSeen, markCopied, markUsed, isNew, setStatus, STATUS_INFO } from './lib/usage'
import { imgSrc } from './lib/imagedb'
import Icon from './components/Icon.vue'
import Tutorial from './components/Tutorial.vue'
import type { PromptSet, Tag, Region, Char, Relation } from './lib/types'
import { CATEGORIES, RATING_LABEL, DEFAULT_GBC_TAIL } from './lib/types'
import LayoutPanel from './components/LayoutPanel.vue'
import { checkLayout } from './lib/layout'
import { elementsJson, gbcText, mossJson, injectWorkflow, loadTemplate, saveTemplate, download } from './lib/comfy'
import type { GenMode } from './lib/translate'
import type { GenSection } from './lib/translate'

const selectedId = ref(doc.sets[0]?.id || '')
const current = computed<PromptSet | undefined>(() => doc.sets.find((s) => s.id === selectedId.value))

const newTagText = ref('')
const showGen = ref(false)
const showSettings = ref(false)
const busyMsg = ref('')
const toast = ref('')

const testing = ref(false)
const testTask = ref<AiTask | ''>('')
const showRoutes = ref(false)
const showHistory = ref(false)
const showManual = ref(false)
// guided tour: first launch, and once again whenever TOUR_VER changes (new UI)
const TOUR_VER = '0.4.0'
const showTour = ref(localStorage.getItem('ps-tour') !== TOUR_VER)
function closeTour() { showTour.value = false; localStorage.setItem('ps-tour', TOUR_VER); localStorage.setItem('ps-manual-seen', '1') }
const themeLabel = computed(() => THEMES.find((t) => t.id === ui.theme)?.label || '')
function nextTheme() { const k = THEMES.findIndex((t) => t.id === ui.theme); ui.theme = THEMES[(k + 1) % THEMES.length].id; markUsed('theme') }
function route(t: AiTask) { return (doc.settings.routes ||= {})[t] ||= {} }
function testRoute(t: AiTask) { testTask.value = t; testConn().finally(() => (testTask.value = '')) }
const testMsg = ref('')
const testOk = ref(false)
async function testConn() {
  testing.value = true
  testMsg.value = ''
  try {
    const r = await chat({ user: '只回复两个字：你好', temperature: 0, task: testTask.value || undefined })
    testOk.value = true
    testMsg.value = '连接成功：' + r.slice(0, 20)
  } catch (e: any) {
    testOk.value = false
    testMsg.value = e?.message || String(e)
  } finally {
    testing.value = false
  }
}

onMounted(async () => {
  // store.ts reports save failures (e.g. quota exceeded) through this event
  window.addEventListener('ps:toast', (e) => flash(String((e as CustomEvent).detail || ''), 5000))
  // A file dropped outside a drop zone would make the browser navigate away to it.
  // Zones call preventDefault first (bubbling), so only unclaimed file drags are blocked.
  const isFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
  window.addEventListener('dragover', (e) => {
    if (!isFiles(e) || e.defaultPrevented) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'none'
  })
  window.addEventListener('drop', (e) => { if (isFiles(e)) e.preventDefault() })
  const m = await autoBackupOnUpdate()
  if (m) flash(m)
})
async function manualBackup() {
  try { const n = await backupAll(); flash(`已备份 ${n} 组到下载文件`) }
  catch (e: any) { flash('备份失败：' + (e?.message || e)) }
}

// ---- layout / appearance ----
const showOut = ref(false)
const showShare = ref(false)
function startSide(e: PointerEvent) {
  dragSplit(e, () => ui.sideW, (v) => (ui.sideW = clampW(v, 180, Math.max(520, window.innerWidth - 640))), 1)
}
function startAside(e: PointerEvent) {
  dragSplit(e, () => ui.asideW, (v) => (ui.asideW = clampW(v, 240, Math.max(760, window.innerWidth - 700))), -1)
}
const secKey = (s?: string) => s || '__none'
const secClosed = (s?: string) => ui.closedSecs.includes(secKey(s))
function toggleSec(s?: string) {
  const k = secKey(s)
  ui.closedSecs = secClosed(s) ? ui.closedSecs.filter((x: string) => x !== k) : [...ui.closedSecs, k]
}
function tapVer() { window.dispatchEvent(new Event('ps:ver-tap')) }

let toastTimer: number | undefined
function flash(msg: string, ms = 1800) {
  clearTimeout(toastTimer)
  toast.value = msg
  toastTimer = window.setTimeout(() => (toast.value = ''), ms)
}

const aiRef = ref<InstanceType<typeof AiTools>>()
function importMeta(m: { positive: string; negative: string; shotId?: string; raw?: string }) {
  const s = newSet((current.value?.name || '返图') + ' 图内参数')
  s.tags = tagsFromPrompt(m.positive, lookup)
  s.negative = m.negative
  // keep the source image as a result shot of the new set (image is shared, deletion is ref-checked)
  if (m.shotId) s.shots = [{ id: m.shotId, at: Date.now(), meta: m.raw }]
  doc.sets.unshift(s)
  selectedId.value = s.id
  if (settings().autoTranslate) translateMissing(true)
}
const labelText = ref('')
function addLabel() {
  const s = current.value
  if (!s) return
  const ls = labelText.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean)
  s.labels = [...new Set([...(s.labels || []), ...ls])]
  labelText.value = ''
  touch(s)
}
function dropLabel(l: string) {
  const s = current.value
  if (!s) return
  s.labels = (s.labels || []).filter((x) => x !== l)
  touch(s)
}

function delSet(s: PromptSet) {
  if (!confirm(`删除「${s.name}」（含返图）？`)) return
  removeSet(s.id)
  if (selectedId.value === s.id) selectedId.value = doc.sets[0]?.id || ''
}

function onAddTag() {
  const set = current.value
  if (!set) return
  const seen = new Set(set.tags.map((t) => t.en.toLowerCase()))
  const parts = newTagText.value.split(/[,，\n]/).map((t) => t.trim()).filter(Boolean)
  let skipped = 0
  for (const p of parts) {
    const k = p.toLowerCase()
    if (seen.has(k)) { skipped++; continue }
    seen.add(k)
    addTag(set, p)
  }
  newTagText.value = ''
  if (skipped) flash(`已跳过 ${skipped} 个重复标签`)
  if (settings().autoTranslate) translateMissing(true)
}

// one-step undo for whole-tag-list rewrites (编辑原文 / 全部重翻)
const tagUndo = ref<{ id: string; tags: Tag[]; label: string } | null>(null)
function snapshotTags(set: PromptSet, label: string) {
  snapshot(set, label + '前')
  tagUndo.value = { id: set.id, tags: JSON.parse(JSON.stringify(set.tags)), label }
}
function undoTags() {
  const u = tagUndo.value
  const s = doc.sets.find((x) => x.id === u?.id)
  if (!u || !s) return
  s.tags = u.tags
  touch(s)
  tagUndo.value = null
  flash('已撤销' + u.label)
}

// Pull English tags that lack a Chinese gloss and translate them via Grok,
// caching results into the shared dictionary.
async function translateMissing(silent = false) {
  const set = current.value
  if (!set) return
  if (busyMsg.value) { if (!silent) flash('正在执行：' + busyMsg.value); return }
  const pending = set.tags.filter((t) => t.en && !t.zh)
  if (!pending.length) { if (!silent) flash('没有需要翻译的标签'); return }
  busyMsg.value = `翻译 ${pending.length} 个标签…`
  try {
    const map = await translateTags(settings().model, pending.map((t) => t.en))
    for (const t of pending) {
      const zh = map[t.en] || map[t.en.toLowerCase()]
      if (zh) { t.zh = zh; remember(t.en, zh) }
    }
    touch(set)
    flash('翻译完成')
  } catch (e: any) {
    flash('翻译失败：' + (e?.message || e))
  } finally {
    busyMsg.value = ''
  }
}

const CHUNK = 60
async function retranslateAll() {
  const set = current.value
  if (!set || !set.tags.length) return
  if (busyMsg.value) { flash('正在执行：' + busyMsg.value); return }
  if (!confirm(`重新翻译全部 ${set.tags.length} 个标签？会覆盖现有中文（可撤销一次）。`)) return
  snapshotTags(set, '全部重翻')
  const all = set.tags.slice()
  try {
    for (let i = 0; i < all.length; i += CHUNK) {
      const part = all.slice(i, i + CHUNK)
      busyMsg.value = `重翻 ${Math.min(i + CHUNK, all.length)}/${all.length} 个标签…`
      const map = await translateTags(settings().model, part.map((t) => t.en))
      for (const t of part) {
        const zh = map[t.en] || map[t.en.toLowerCase()]
        if (zh) { t.zh = zh; remember(t.en, zh) }
      }
      touch(set)
    }
    flash('已重新翻译（可撤销）')
  } catch (e: any) {
    flash('翻译失败：' + (e?.message || e))
  } finally {
    busyMsg.value = ''
  }
}

async function copyPrompt(headers = true) {
  if (!current.value) return
  try {
    await navigator.clipboard.writeText(promptText(current.value, headers))
    markCopied(current.value)
    flash(headers ? '已复制（带分段标题）' : '已复制（单行）')
  } catch (e: any) {
    flash('复制失败：' + (e?.message || e))
  }
}

// Chips grouped by section so the 【Section】 layout is visible while editing.
const groups = computed(() => (current.value ? groupTags(current.value.tags) : []))
const hasSections = computed(() => !!current.value?.tags.some((t) => t.section))
const sectionNames = computed(() => [...new Set((current.value?.tags || []).map((t) => t.section).filter(Boolean))] as string[])

// ---- tag bulk ops ----
const tagMode = ref(false)
const tagSel = ref<string[]>([])
watch(selectedId, () => { tagSel.value = []; showLayout.value = !!current.value?.regions?.length })
// opening a set marks it 看过 (status shown in the list)
watch(current, (s) => markSeen(s), { immediate: true })
const tagDs = useDragSelect()
let sweptId = ''
function tagDown(e: MouseEvent, id: string) {
  if (!tagMode.value || tagSel.value.includes(id)) return // selected chips stay draggable for moving
  sweptId = id
  tagDs.start(e, id, false, setTagSel)
}
function tagClick(id: string) {
  if (!tagMode.value) return
  if (sweptId === id) { sweptId = ''; return }
  toggleTagSel(id)
}
function setTagSel(id: string, on: boolean) {
  const i = tagSel.value.indexOf(id)
  if (on && i < 0) tagSel.value.push(id)
  else if (!on && i >= 0) tagSel.value.splice(i, 1)
}
function toggleTagSel(id: string) {
  const i = tagSel.value.indexOf(id)
  i >= 0 ? tagSel.value.splice(i, 1) : tagSel.value.push(id)
}
function selectAllTags() {
  const all = current.value?.tags.map((t) => t.id) || []
  tagSel.value = tagSel.value.length === all.length ? [] : all
}
function invertTags() {
  tagSel.value = (current.value?.tags || []).filter((t) => !tagSel.value.includes(t.id)).map((t) => t.id)
}
function selectGroup(g: { tags: Tag[] }) {
  const ids = g.tags.map((t) => t.id)
  const allIn = ids.every((id) => tagSel.value.includes(id))
  tagSel.value = allIn ? tagSel.value.filter((id) => !ids.includes(id)) : [...new Set([...tagSel.value, ...ids])]
}
function selectedTags() { return (current.value?.tags || []).filter((t) => tagSel.value.includes(t.id)) }
function bulkDeleteTags() {
  const set = current.value
  if (!set || !tagSel.value.length) return
  if (!confirm(`删除选中的 ${tagSel.value.length} 个标签？`)) return
  snapshot(set, '批量删除前')
  set.tags = set.tags.filter((t) => !tagSel.value.includes(t.id))
  flash(`已删除 ${tagSel.value.length} 个标签`)
  tagSel.value = []
  touch(set)
}
const bulkSection = ref('')
function bulkMoveSection() {
  const set = current.value
  if (!set || !tagSel.value.length) return
  const sec = bulkSection.value.trim() || undefined
  const ids = tagSel.value.slice()
  // move to the end of that section (or to the end) so they stay contiguous
  const moving = set.tags.filter((t) => ids.includes(t.id))
  moving.forEach((t) => (t.section = sec))
  const rest = set.tags.filter((t) => !ids.includes(t.id))
  let idx = -1
  rest.forEach((t, i) => { if (t.section === sec) idx = i })
  rest.splice(idx >= 0 ? idx + 1 : rest.length, 0, ...moving)
  set.tags = rest
  touch(set)
}
const bulkWeight = ref(1)
function bulkSetWeight() {
  for (const t of selectedTags()) t.weight = Math.min(2, Math.max(0.1, bulkWeight.value || 1))
  current.value && touch(current.value)
}
function bulkBump(d: number) {
  for (const t of selectedTags()) t.weight = Math.min(2, Math.max(0.1, Math.round((t.weight + d) * 100) / 100))
  current.value && touch(current.value)
}
function renameSection(g: { section?: string; tags: Tag[] }) {
  const name = prompt('分区名称（留空 = 无分区）', g.section || '')
  if (name === null) return
  for (const t of g.tags) t.section = name.trim() || undefined
  current.value && touch(current.value)
}

// ---- drag & drop: tags (multi when selected) and whole sections ----
let dragIds: string[] = []
let dragGroup = -1
const dropHint = ref('')
function onTagDragStart(t: Tag, e: DragEvent) {
  dragGroup = -1
  dragIds = tagSel.value.includes(t.id) ? tagSel.value.slice() : [t.id]
  e.dataTransfer?.setData('text/plain', t.en)
}
function moveTagsTo(targetId: string | null, after: boolean, section: string | undefined) {
  const set = current.value
  if (!set || !dragIds.length) return
  if (targetId && dragIds.includes(targetId)) return
  const ids = dragIds
  const moving = set.tags.filter((t) => ids.includes(t.id))
  moving.forEach((t) => (t.section = section))
  const rest = set.tags.filter((t) => !ids.includes(t.id))
  let idx = rest.length
  if (targetId) {
    idx = rest.findIndex((t) => t.id === targetId)
    if (after) idx++
  }
  rest.splice(idx, 0, ...moving)
  set.tags = rest
  touch(set)
}
function onTagDrop(target: Tag, e: DragEvent) {
  dropHint.value = ''
  if (dragGroup >= 0) return onGroupDrop(groups.value.findIndex((g) => g.tags.includes(target)))
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  moveTagsTo(target.id, e.clientX > r.left + r.width / 2, target.section)
  dragIds = []
}
function onGroupAreaDrop(gi: number) {
  dropHint.value = ''
  if (dragGroup >= 0) return onGroupDrop(gi)
  const g = groups.value[gi]
  if (!g || !dragIds.length) return
  const others = g.tags.filter((t) => !dragIds.includes(t.id))
  const last = others[others.length - 1]
  moveTagsTo(last ? last.id : null, true, g.section)
  dragIds = []
}
function onGroupDragStart(gi: number, e: DragEvent) {
  dragGroup = gi
  dragIds = []
  e.dataTransfer?.setData('text/plain', 'group')
}
function onDragEnd() {
  dragIds = []
  dragGroup = -1
  dropHint.value = ''
}
function onGroupDrop(to: number) {
  const set = current.value
  const from = dragGroup
  dragGroup = -1
  if (!set || from < 0 || to < 0 || from === to) return
  const gs = groups.value.map((g) => g.tags)
  const [m] = gs.splice(from, 1)
  gs.splice(to, 0, m)
  set.tags = gs.flat()
  touch(set)
}
function moveGroup(gi: number, d: number) {
  dragGroup = gi
  onGroupDrop(gi + d)
}

function applyGenerated(p: { name: string; prefix: string; sections: GenSection[]; negative: string[]; regions?: Region[]; canvas?: { w: number; h: number }; chars?: Char[]; relations?: Relation[] }) {
  const set = newSet(p.name || '生成')
  if (p.regions?.length) { set.regions = p.regions; set.canvas = p.canvas; showLayout.value = true }
  if (p.relations?.length) set.relations = p.relations
  if (p.chars?.length) set.chars = p.chars
  set.tags = buildTags(p.prefix, p.sections)
  set.negative = p.negative.join(', ')
  doc.sets.unshift(set)
  selectedId.value = set.id
  showGen.value = false
  if (settings().autoTranslate) translateMissing(true)
}

// ---- layout (bboxes) on the current set ----
const showLayout = ref(false)
// GBC sets show per-box tags and the relation editor
const isGbcSet = computed(() => {
  const s = current.value
  return !!s && (settings().genFormat === 'gbc' || !!s.relations?.length || !!s.regions?.some((r) => r.tags))
})
const relsOf = (s: PromptSet) => (s.relations ||= [])
const cover = computed(() => { const id = current.value?.shots?.[0]?.id; return id ? imgSrc(id) : '' })
const curStatus = computed(() => (current.value ? setStatus(current.value) : 'new'))
const untranslated = computed(() => (current.value?.tags || []).filter((t) => !t.zh && /[a-z]/i.test(t.en)).length)
function ensureLayout() {
  const s = current.value
  if (!s) return
  s.regions ||= []
  s.canvas ||= { w: 832, h: 1216 }
  showLayout.value = !showLayout.value
}
// [{text, bbox:[x1,y1,x2,y2]}] in 0–1 floats or 0–1000 ints (setting)
function bboxJson(s: PromptSet): string {
  const k = settings().bboxScale === 1 ? 1 : 1000
  const q = (v: number) => (k === 1 ? Math.round(v * 1000) / 1000 : Math.round(v * 1000))
  return JSON.stringify({
    width: s.canvas?.w, height: s.canvas?.h,
    prompt: promptText(s, false),
    regions: (s.regions || []).map((r) => ({ text: r.text, bbox: [q(r.x), q(r.y), q(r.x + r.w), q(r.y + r.h)] })),
  }, null, 2)
}
async function copyBboxes() {
  if (!current.value) return
  try {
    await navigator.clipboard.writeText(bboxJson(current.value))
    markCopied(current.value)
    flash('已复制框坐标 JSON')
  } catch (e: any) {
    flash('复制失败：' + (e?.message || e))
  }
}

// ---- ComfyUI (official CreateBoundingBoxes + MOSSImageLayoutPrompt) ----
const comfyTpl = ref(loadTemplate())
// ---- check for updates ----
const updBusy = ref(false)
const RELEASES = 'https://github.com/CtingBall/PromptStudio/releases/latest'
const newer = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}
async function checkUpdate() {
  updBusy.value = true
  try {
    if (IS_DESKTOP) {
      const r = await (await fetch('/update/check')).json()
      if (r.state === 'latest') flash(`已是最新版本 V${r.current}`)
      else if (r.state === 'available') flash(`发现新版本 V${r.version}，正在后台下载，下载完会提示重启`, 6000)
      else if (r.state === 'downloaded') flash(`V${r.version} 已下载好，重启即可完成更新`)
      else if (r.state === 'dev') flash('开发模式下不检查更新')
      else flash('检查更新失败：' + (r.error || '连不上 GitHub，请检查网络'), 6000)
    } else {
      const r = await fetch('https://api.github.com/repos/CtingBall/PromptStudio/releases/latest')
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const v = String((await r.json()).tag_name || '').replace(/^v/i, '')
      if (v && newer(v, APP_VERSION)) {
        if (confirm(`发现新版本 V${v}（当前 V${APP_VERSION}），打开下载页？`)) window.open(RELEASES, '_blank')
      } else flash(`已是最新版本 V${APP_VERSION}`)
    }
  } catch (e: any) {
    flash('检查更新失败：' + (e?.message || e), 6000)
  } finally {
    updBusy.value = false
  }
}

async function copyGbc() {
  const s = current.value
  if (!s) return
  try {
    await navigator.clipboard.writeText(gbcText(s, settings().gbcTail ?? DEFAULT_GBC_TAIL))
    markCopied(current.value)
    flash('已复制 GBC 格式：直接粘进正向提示词（MOSS-Image-heal 等）')
  } catch (e: any) {
    flash('复制失败：' + (e?.message || e))
  }
}
async function copyMoss() {
  const s = current.value
  if (!s) return
  try {
    await navigator.clipboard.writeText(mossJson(s, promptText(s, false), doc.settings.firstLine || ''))
    markCopied(current.value)
    const w = checkLayout(s.regions || [])
    flash('已复制 MOSS 布局 JSON：直接粘进正向提示词（文本编码器）' + (w.length ? '。⚠ ' + w.join('；') : ''), w.length ? 7000 : 3500)
  } catch (e: any) {
    flash('复制失败：' + (e?.message || e))
  }
}
async function copyComfy() {
  if (!current.value) return
  try {
    await navigator.clipboard.writeText(elementsJson(current.value))
    markCopied(current.value)
    const w = checkLayout(current.value.regions || [])
    flash('已复制：粘进文本节点 → 接到 Create Bounding Boxes 的 bboxes' + (w.length ? '。⚠ ' + w.join('；') : ''), w.length ? 7000 : 3500)
  } catch (e: any) {
    flash('复制失败：' + (e?.message || e))
  }
}
function pickTemplate(): Promise<boolean> {
  return new Promise((res) => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = '.json,application/json'
    inp.onchange = async () => {
      const f = inp.files?.[0]
      if (!f) return res(false)
      try {
        const txt = await f.text()
        if (!txt.includes('CreateBoundingBoxes')) throw new Error('这个工作流里没有 Create Bounding Boxes 节点')
        saveTemplate(f.name, txt)
        comfyTpl.value = loadTemplate()
        res(true)
      } catch (e: any) {
        flash('模板无效：' + (e?.message || e), 4000)
        res(false)
      }
    }
    inp.click()
  })
}
async function exportComfy(change = false) {
  const s = current.value
  if (!s) return
  if ((change || !comfyTpl.value) && !(await pickTemplate())) return
  if (change) { flash('模板已更换：' + comfyTpl.value!.name); return }
  try {
    const r = injectWorkflow(comfyTpl.value!.json, s, promptText(s, false))
    const base = comfyTpl.value!.name.replace(/\.json$/i, '')
    download(`${base}_${(s.name || 'layout').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30)}.json`, r.json)
    const w = checkLayout(s.regions || [])
    flash('已导出，拖进 ComfyUI 即可。' + r.log.join('；') + (w.length ? '。⚠ ' + w.join('；') : ''), w.length ? 8000 : 6000)
  } catch (e: any) {
    flash('导出失败：' + (e?.message || e), 4000)
  }
}

// ---- generate dialog launcher (rewrite mode prefilled with current prompt) ----
const genMode = ref<GenMode>('theme')
const genRaw = ref('')
function openGen(mode: GenMode = 'theme') {
  markUsed('gen')
  genMode.value = mode
  genRaw.value = mode === 'rewrite' && current.value ? promptText(current.value, false) : ''
  showGen.value = true
}

const xfer = ref<'' | 'export' | 'import'>('')
const xferIds = ref<string[]>([])
function openXfer(mode: 'export' | 'import', ids: string[] = []) {
  markUsed('export')
  xferIds.value = ids
  xfer.value = mode
}

// re-parse the raw prompt box back into chips
const rawEdit = ref(false)
const rawText = ref('')
function openRaw() {
  if (!current.value) return
  rawText.value = promptText(current.value)
  rawEdit.value = true
}
function applyRaw() {
  const set = current.value
  if (!set) return
  // keep manual Chinese glosses and notes for words that survive the edit
  const old = new Map(set.tags.map((t) => [t.en.toLowerCase(), t]))
  snapshotTags(set, '编辑原文')
  set.tags = tagsFromPrompt(rawText.value, lookup).map((t) => {
    const o = old.get(t.en.toLowerCase())
    return o ? { ...t, zh: o.zh || t.zh, ...(o.note ? { note: o.note } : {}) } : t
  })
  touch(set)
  rawEdit.value = false
  flash('已应用（可撤销）')
  if (settings().autoTranslate) translateMissing(true)
}

function newBlank() { const s = newSet('未命名'); doc.sets.unshift(s); selectedId.value = s.id }
function dupSet(id: string) {
  const c = duplicateSet(id)
  if (c) selectedId.value = c.id
}
function clampMaxImages() {
  doc.settings.maxImages = Math.min(8, Math.max(1, Math.round(Number(doc.settings.maxImages) || 4)))
}
</script>

<template>
  <div class="app">
    <div class="body">
      <nav class="rail" data-tour="rail">
        <button class="rail-brand" title="千夏绘卷 Chinatsu Scroll" @click="tapVer"><img src="/art/avatar-sm.webp" alt="" /></button>
        <button class="rail-btn hot" data-tour="gen" title="用一句话或参考图让 AI 写一整组提示词" @click="openGen('theme')">
          <Icon name="sparkles" /><span>一键生成</span><i v-if="isNew('gen')" class="dot" /></button>
        <button class="rail-btn" title="导入提示词组 / 备份文件" @click="openXfer('import')"><Icon name="import" /><span>导入</span></button>
        <button class="rail-btn" title="导出选中的提示词组" @click="openXfer('export')"><Icon name="export" /><span>导出</span><i v-if="isNew('export')" class="dot" /></button>
        <button class="rail-btn" title="分享码 / Gist 链接" @click="showShare = true; markUsed('share')"><Icon name="link" /><span>分享</span><i v-if="isNew('share')" class="dot" /></button>
        <span class="rail-sep" />
        <button class="rail-btn" title="重新看一遍新手引导" @click="showTour = true"><Icon name="compass" /><span>教程</span></button>
        <button class="rail-btn" title="详细的使用手册" @click="showManual = true"><Icon name="book" /><span>手册</span></button>
        <span class="spacer" />
        <button class="rail-btn" :title="'主题：' + themeLabel + '（点击切换）'" @click="nextTheme"><Icon :name="ui.theme === 'light' ? 'sun' : ui.theme === 'sakura' ? 'sakura' : 'moon'" /><span>{{ themeLabel }}</span><i v-if="isNew('theme')" class="dot" /></button>
        <button class="rail-btn" :title="ui.asideOpen ? '收起右侧返图/AI 面板' : '展开右侧返图/AI 面板'" @click="ui.asideOpen = !ui.asideOpen"><Icon name="picture" /><span>{{ ui.asideOpen ? '收起返图' : '返图/AI' }}</span></button>
        <button class="rail-btn" title="设置（API、外观、数据）" @click="showSettings = true"><Icon name="gear" /><span>设置</span><i v-if="!doc.settings.apiKey" class="dot" title="还没填 API Key" /></button>
        <small class="rail-ver" @click="tapVer">V{{ APP_VERSION }}</small>
      </nav>
      <Sidebar v-model:selected="selectedId" @toast="flash" @export="openXfer('export', $event)" />
      <div class="splitter" title="拖动调整宽度" @pointerdown="startSide" @dblclick="ui.sideW = 280" />

      <main v-if="current" class="main" data-tour="editor">
        <div v-if="busyMsg" class="busy-bar"><span class="spin" />{{ busyMsg }}</div>
        <div class="set-hero">
          <div class="hero-cover" :title="current.shots?.length ? '封面：第一张返图' : '还没有返图'">
            <img v-if="cover" :src="cover" alt="" />
            <Icon v-else name="palette" :size="34" />
          </div>
          <div class="hero-main">
            <div class="row">
              <button class="ghost icon-btn" :class="{ fav: current.favorite }" title="收藏"
                @click="current.favorite = !current.favorite; touch(current!)"><Icon name="star" :class="{ off: !current.favorite }" /></button>
              <input v-model="current.name" class="title-input" @change="touch(current!)" />
            </div>
            <div class="row wrap hero-meta">
              <span :class="['status-pill', 'st-' + curStatus]" :title="STATUS_INFO[curStatus].hint"><Icon :name="STATUS_INFO[curStatus].icon" />{{ STATUS_INFO[curStatus].label }}</span>
              <span class="muted set-date" :title="'创建 ' + fmtDate(current.createdAt, true) + '\n修改 ' + fmtDate(current.updatedAt, true)">{{ fmtDate(current.createdAt) }}</span>
              <span v-if="current.copiedAt" class="muted" :title="fmtDate(current.copiedAt, true)">· 上次复制 {{ fmtDate(current.copiedAt) }}</span>
              <select v-model="current.category" :class="['sm', current.category ? 'r-' + current.category : '']" style="width: auto" @change="touch(current!)">
                <option :value="undefined">未分级</option>
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ RATING_LABEL[c] }}</option>
              </select>
              <input v-model="current.folder" class="sm" list="folder-list" placeholder="文件夹，如 角色/hanabi" style="width: 170px" @change="touch(current!)" />
              <datalist id="folder-list"><option v-for="f in folders" :key="f" :value="f" /></datalist>
              <span v-for="l in current.labels || []" :key="l" class="pill on" title="点击移除" @click="dropLabel(l)">{{ l }} ×</span>
              <input v-model="labelText" class="sm" placeholder="＋标签，回车添加" style="width: 120px" @keydown.enter="!$event.isComposing && addLabel()" />
            </div>
          </div>
          <div class="hero-act">
            <button class="primary big" data-tour="copy" title="复制分段提示词，拿去跑图（会标记为「跑过」）" @click="copyPrompt(true)"><Icon name="clipboard" /> 复制提示词</button>
            <div class="btn-group">
              <button title="复制成一行，没有分段标题" @click="copyPrompt(false)">单行</button>
              <button :title="'AI 修改或批量操作前自动保存，最多 15 个'" @click="showHistory = true; markUsed('history')"><Icon name="history" /> 历史{{ current.history?.length ? ' ' + current.history.length : '' }}</button>
              <button title="复制一份" @click="dupSet(current.id)"><Icon name="copy" /></button>
              <button class="danger" title="删除这一组" @click="delSet(current)"><Icon name="trash" /></button>
            </div>
          </div>
        </div>

        <section class="section">
          <div class="section-head">
            <button class="collapse-btn" :title="ui.tagsOpen ? '收起标签' : '展开标签'" @click="ui.tagsOpen = !ui.tagsOpen">{{ ui.tagsOpen ? '▾' : '▸' }}</button>
            <h4 style="cursor: pointer" @click="ui.tagsOpen = !ui.tagsOpen"><Icon name="tag" /> 标签</h4>
            <span class="badge">{{ current.tags.length }}</span>
            <span v-if="untranslated" class="badge warn" title="还没有中文翻译的标签">{{ untranslated }} 个未译</span>
            <span class="spacer" />
            <div class="btn-group">
              <button :disabled="!!busyMsg" @click="translateMissing()"><Icon name="translate" /> 翻译未译</button>
              <button :disabled="!!busyMsg" @click="retranslateAll">全部重翻</button>
            </div>
            <button v-if="tagUndo && tagUndo.id === current.id && !busyMsg" class="ghost" @click="undoTags">↶ 撤销{{ tagUndo.label }}</button>
            <div class="btn-group">
              <button @click="openRaw"><Icon name="pencil" /> 编辑原文</button>
              <button @click="openGen('rewrite'); markUsed('rewrite')"><Icon name="wand" /> AI 改写格式<i v-if="isNew('rewrite')" class="dot" /></button>
              <button :class="{ on: showLayout }" @click="ensureLayout(); markUsed('layout')"><Icon name="ruler" /> 画框布局<span v-if="current.regions?.length" class="badge" style="margin-left: 4px">{{ current.regions.length }}</span><i v-if="isNew('layout')" class="dot" /></button>
            </div>
            <button :class="tagMode ? 'primary' : ''" @click="tagMode = !tagMode; tagSel = []">
              <Icon name="checklist" /> {{ tagMode ? '退出批量' : '批量编辑' }}</button>
          </div>

          <template v-if="ui.tagsOpen">
          <div v-if="tagMode" class="toolbar" style="padding: 6px; background: var(--panel2); border-radius: 8px; margin-bottom: 6px">
            <div class="btn-group">
              <button @click="selectAllTags">全选</button>
              <button @click="invertTags">反选</button>
            </div>
            <span class="muted">已选 {{ tagSel.length }}</span>
            <input v-model="bulkSection" list="sec-list" placeholder="分区名(空=无)" style="width: 130px" />
            <datalist id="sec-list"><option v-for="n in sectionNames" :key="n" :value="n" /></datalist>
            <button @click="bulkMoveSection">移到分区</button>
            <div class="btn-group">
              <button @click="bulkBump(-0.1)">权重−</button>
              <button @click="bulkBump(0.1)">权重＋</button>
            </div>
            <input v-model.number="bulkWeight" type="number" step="0.1" min="0.1" max="2" style="width: 64px" />
            <button @click="bulkSetWeight">设权重</button>
            <button class="danger" @click="bulkDeleteTags">删除选中</button>
          </div>

          <div v-for="(g, gi) in groups" :key="gi" class="tag-group" @dragover.prevent @drop.prevent="onGroupAreaDrop(gi)">
            <div v-if="hasSections" class="row sec-head" draggable="true"
              @dragstart="onGroupDragStart(gi, $event)" @dragend="onDragEnd" @dblclick="renameSection(g)">
              <span>⠿</span>
              <button class="collapse-btn" :title="secClosed(g.section) ? '展开本区' : '收起本区'" @click.stop="toggleSec(g.section)">{{ secClosed(g.section) ? '▸' : '▾' }}</button>
              <span>【{{ g.section || '无分区' }}】</span>
              <span class="badge">{{ g.tags.length }}</span>
              <span class="sec-btns">
                <button class="ghost" title="上移" @click="moveGroup(gi, -1)">↑</button>
                <button class="ghost" title="下移" @click="moveGroup(gi, 1)">↓</button>
                <button v-if="tagMode" class="ghost" @click="selectGroup(g)">选本区</button>
              </span>
            </div>
            <div v-if="!hasSections || !secClosed(g.section)" class="chip-grid">
              <div v-for="t in g.tags" :key="t.id" :draggable="!tagMode || tagSel.includes(t.id)"
                :class="['chip-wrap', { sel: tagSel.includes(t.id) }]"
                @mousedown="tagDown($event, t.id)" @mouseenter="tagMode && tagDs.over(t.id)"
                @dragstart.stop="onTagDragStart(t, $event)" @dragend="onDragEnd" @dragover.prevent
                @drop.prevent.stop="onTagDrop(t, $event)" @click="tagClick(t.id)">
                <TagChip :tag="t" @remove="removeTag(current!, t.id)" @change="touch(current!)" />
              </div>
            </div>
          </div>

          <div class="row" style="margin-top: 10px">
            <input v-model="newTagText" placeholder="添加标签，可用逗号一次加多个…" style="flex: 1" @keydown.enter="!$event.isComposing && onAddTag()" />
            <button class="primary" @click="onAddTag">添加</button>
          </div>
          <p class="hint">双击中/英文修改（输入框随内容变大，Enter 确认）；拖动标签排序或拖到其他分区；拖动分区标题调整顺序，双击标题改名。</p>
          </template>
        </section>

        <section v-if="showLayout && current.regions && current.canvas" class="section">
          <div class="section-head">
            <h4><Icon name="ruler" /> 画框布局（区域提示词）</h4>
            <span class="badge">{{ current.regions.length }} 个框</span>
            <span class="spacer" />
            <button @click="copyBboxes">复制框坐标 JSON</button>
            <button title="完整布局 JSON（含总描述和首行触发），直接当正向提示词用，不需要画框节点" @click="copyMoss">复制 MOSS JSON</button>
            <button title="KohakuGBC 的 gbc.soft 文本：总描述 + 标签 + 每个框一行，直接当正向提示词用" @click="copyGbc">复制 GBC</button>
            <button title="粘贴到 ComfyUI 一个文本节点，接到 Create Bounding Boxes 的 bboxes 输入" @click="copyComfy">复制给 ComfyUI</button>
            <button class="primary" :title="comfyTpl ? '模板：' + comfyTpl.name : '首次需选择你的 MOSS 画框工作流 .json'" @click="exportComfy()">导出 ComfyUI 工作流</button>
            <button v-if="comfyTpl" class="ghost" title="更换模板工作流" @click="exportComfy(true)">换模板</button>
            <button class="ghost" @click="showLayout = false">收起</button>
          </div>
          <LayoutPanel :regions="current.regions" :canvas="current.canvas" :chars="current.chars"
            :gbc="isGbcSet" :relations="isGbcSet ? relsOf(current) : undefined" @change="touch(current!)" />
        </section>

        <section class="section">
          <div class="section-head"><h4><Icon name="negative" /> 负向提示词</h4></div>
          <textarea v-model="current.negative" rows="2" placeholder="nsfw, worst quality, bad anatomy…" @change="touch(current!)" />
        </section>

        <section class="section">
          <div class="section-head">
            <button class="collapse-btn" @click="showOut = !showOut">{{ showOut ? '▾' : '▸' }}</button>
            <h4 style="cursor: pointer" @click="showOut = !showOut"><Icon name="scroll" /> 正向提示词（输出预览）</h4>
            <span class="spacer" />
            <button class="ghost" @click="copyPrompt(true)"><Icon name="clipboard" /> 复制</button>
          </div>
          <textarea v-if="showOut" class="out-box" :value="promptText(current)" rows="10" readonly />
        </section>
      </main>
      <main v-else class="main empty-main">
        <div class="empty-card">
          <img src="/art/empty.webp" alt="" />
          <h3>还没有选中提示词组</h3>
          <p class="muted">在左边选一组，或者让 AI 帮你写一组新的。</p>
          <div class="row" style="justify-content: center">
            <button class="primary big" @click="openGen('theme')"><Icon name="sparkles" /> 一键生成</button>
            <button class="big" @click="newBlank"><Icon name="plus" /> 新建空白组</button>
          </div>
        </div>
      </main>

      <template v-if="current">
        <div v-show="ui.asideOpen" class="splitter right" title="拖动调整宽度，双击恢复" @pointerdown="startAside" @dblclick="ui.asideW = 360" />
        <aside v-show="ui.asideOpen" class="aside" data-tour="aside">
          <Gallery :set="current" @toast="flash" @review="aiRef?.reviewImage($event)"
            @reverse="aiRef?.reverseImage($event)" @import-meta="importMeta" />
          <AiTools ref="aiRef" :set="current" @toast="flash" @select="selectedId = $event" />
        </aside>
      </template>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <!-- raw edit modal -->
    <div v-if="rawEdit" class="modal-mask">
      <div class="modal">
        <h3 style="margin-top: 0">编辑原文提示词</h3>
        <p class="muted">直接修改逗号分隔的提示词，可保留【分段】标题，应用后会重新拆成标签。</p>
        <textarea v-model="rawText" rows="14" />
        <div class="row" style="margin-top: 12px">
          <span class="spacer" />
          <button class="ghost" @click="rawEdit = false">取消</button>
          <button class="primary" @click="applyRaw">应用</button>
        </div>
      </div>
    </div>

    <!-- settings modal -->
    <div v-if="showSettings" class="modal-mask" @click.self="showSettings = false">
      <div class="modal">
        <h3 style="margin-top: 0"><Icon name="gear" /> 设置</h3>
        <div class="settings-grid">
          <label>
            API 地址（OpenAI 兼容 base，以 /v1 结尾）
            <input v-model="doc.settings.baseUrl" placeholder="https://api.x.ai/v1"
              style="width: 100%; margin-top: 4px" />
          </label>
          <label>
            API Key
            <input v-model="doc.settings.apiKey" type="password" placeholder="xai-… 或中转站 key"
              style="width: 100%; margin-top: 4px" />
          </label>
          <label>
            模型
            <input v-model="doc.settings.model" placeholder="grok-4-fast"
              style="width: 100%; margin-top: 4px" />
          </label>
          <div>
            <button class="ghost sm" @click="showRoutes = !showRoutes">{{ showRoutes ? '▾' : '▸' }} 各功能单独设置模型（详情）</button>
            <span class="muted" style="font-size: 12px; margin-left: 6px">不填就用上面的主 AI</span>
            <div v-if="showRoutes" class="route-list">
              <div v-for="t in AI_TASKS" :key="t.id" class="route-row">
                <div><strong>{{ t.label }}</strong><div class="muted" style="font-size: 12px">{{ t.hint }}</div></div>
                <input v-model="route(t.id).model" :placeholder="'模型（默认 ' + (doc.settings.model || '主模型') + '）'" />
                <input v-model="route(t.id).baseUrl" placeholder="地址（默认同主 AI）" />
                <input v-model="route(t.id).apiKey" type="password" placeholder="Key（默认同主 AI）" />
                <button class="ghost sm" :disabled="testing" @click="testRoute(t.id)">测试</button>
              </div>
            </div>
          </div>
          <label>
            翻译温度 {{ doc.settings.temperature.toFixed(2) }}
            <input type="range" min="0" max="1" step="0.05" v-model.number="doc.settings.temperature" style="width: 100%" />
          </label>
          <label class="row">
            <input type="checkbox" v-model="doc.settings.autoTranslate" style="width: auto" />
            添加/生成标签后自动翻译
          </label>
          <label>
            每次最多参考图数量（需要能看图的模型，如 grok-4 系列）
            <input v-model.number="doc.settings.maxImages" type="number" min="1" max="8" style="width: 80px; margin-left: 6px" @change="clampMaxImages" />
          </label>
          <label>
            框坐标 JSON 格式
            <select v-model.number="doc.settings.bboxScale" style="width: auto; margin-left: 6px">
              <option :value="1000">0–1000 整数</option>
              <option :value="1">0–1 小数</option>
            </select>
          </label>
          <label>
            GBC 结尾行（复制 GBC 时加在最后，如 masterpiece, recent, safe；留空不加）
            <input v-model="doc.settings.gbcTail" style="margin-left: 6px; width: 260px" placeholder="masterpiece, recent, safe" />
          </label>
          <label>
            MOSS 首行触发（复制 MOSS JSON 时放在第一行，如 &lt;|artist|&gt;fkey&lt;|/artist|&gt;）
            <input v-model="doc.settings.firstLine" placeholder="留空则不加" />
          </label>
          <h5>外观</h5>
          <div class="row wrap">
            <div class="btn-group">
              <button v-for="t in THEMES" :key="t.id" :class="{ on: ui.theme === t.id }" @click="ui.theme = t.id">{{ t.label }}</button>
            </div>
            <label class="row">缩放 {{ ui.scale }}%
              <input v-model.number="ui.scale" type="range" min="70" max="150" step="5" style="width: 140px" /></label>
            <label class="row"><input v-model="ui.compact" type="checkbox" style="width: auto" />紧凑模式</label>
          </div>
          <h5>数据</h5>
          <div class="row" style="gap: 8px">
            <button class="ghost" @click="manualBackup">备份全部数据</button>
            <span class="muted" style="font-size: 12px; user-select: none" @click="tapVer">当前版本 V{{ APP_VERSION }}</span>
            <button class="ghost" :disabled="updBusy" @click="checkUpdate">{{ updBusy ? '检查中…' : '检查更新' }}</button>
          </div>
          <div class="row" style="gap: 8px">
            <button class="ghost" :disabled="testing" @click="testConn">测试连接</button>
            <span v-if="testMsg" :style="{ color: testOk ? 'var(--accent2)' : 'var(--danger)' }">{{ testMsg }}</span>
          </div>
          <p class="muted">
            地址 + Key 填你自己的（官方 x.ai 或中转站都行）。Key 存在本机浏览器里，
            调用时经本地转发发往该地址，不会跨域、也不进前端打包。
          </p>
        </div>
        <div class="row" style="margin-top: 14px">
          <span class="spacer" />
          <button class="primary" @click="showSettings = false">完成</button>
        </div>
      </div>
    </div>

    <HistoryDialog v-if="showHistory && current" :set="current" @close="showHistory = false" @toast="flash" />
    <ManualDialog v-if="showManual" @close="showManual = false" />
    <Tutorial v-if="showTour" @close="closeTour" @manual="showManual = true" />
    <TransferDialog v-if="xfer" :mode="xfer" :preselect="xferIds" :current="selectedId"
      @close="xfer = ''" @toast="flash" @select="selectedId = $event" />
    <Credits />
    <ShareDialog v-if="showShare" :current="selectedId" @close="showShare = false" @toast="flash" @select="selectedId = $event" />
    <GenerateDialog v-if="showGen" :initial-mode="genMode" :initial-raw="genRaw" @close="showGen = false" @apply="applyGenerated" />
  </div>
</template>
