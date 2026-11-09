<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { autoBackupOnUpdate, backupAll, APP_VERSION } from './lib/autobackup'
import { ui, THEMES, dragSplit, clampW } from './lib/ui'
import TagChip from './components/TagChip.vue'
import GenerateDialog from './components/GenerateDialog.vue'
import Sidebar from './components/Sidebar.vue'
import Gallery from './components/Gallery.vue'
import AiTools from './components/AiTools.vue'
import TransferDialog from './components/TransferDialog.vue'
import Credits from './components/Credits.vue'
import {
  doc, removeSet, duplicateSet, touch, addTag, removeTag,
  promptText, remember, settings, newSet, buildTags, folders,
} from './lib/store'
import { translateTags } from './lib/translate'
import { chat } from './lib/grok'
import { tagsFromPrompt, groupTags } from './lib/tags'
import { lookup } from './lib/store'
import type { PromptSet, Tag, Region } from './lib/types'
import { CATEGORIES, RATING_LABEL } from './lib/types'
import LayoutPanel from './components/LayoutPanel.vue'
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
const testMsg = ref('')
const testOk = ref(false)
async function testConn() {
  testing.value = true
  testMsg.value = ''
  try {
    const r = await chat({ user: '只回复两个字：你好', temperature: 0 })
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
  const m = await autoBackupOnUpdate()
  if (m) flash(m)
})
async function manualBackup() {
  try { const n = await backupAll(); flash(`已备份 ${n} 组到下载文件`) }
  catch (e: any) { flash('备份失败：' + (e?.message || e)) }
}

// ---- layout / appearance ----
const showOut = ref(false)
function startSide(e: PointerEvent) {
  dragSplit(e, () => ui.sideW, (v) => (ui.sideW = clampW(v, 200, 520)), 1)
}
function startAside(e: PointerEvent) {
  dragSplit(e, () => ui.asideW, (v) => (ui.asideW = clampW(v, 260, 760)), -1)
}
const secKey = (s?: string) => s || '__none'
const secClosed = (s?: string) => ui.closedSecs.includes(secKey(s))
function toggleSec(s?: string) {
  const k = secKey(s)
  ui.closedSecs = secClosed(s) ? ui.closedSecs.filter((x: string) => x !== k) : [...ui.closedSecs, k]
}
function tapVer() { window.dispatchEvent(new Event('ps:ver-tap')) }
function zoom(d: number) { ui.scale = d ? clampW(ui.scale + d, 70, 150) : 100 }

function flash(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 1800)
}

const aiRef = ref<InstanceType<typeof AiTools>>()
function importMeta(m: { positive: string; negative: string }) {
  const s = newSet((current.value?.name || '返图') + ' 图内参数')
  s.tags = tagsFromPrompt(m.positive, lookup)
  s.negative = m.negative
  doc.sets.unshift(s)
  selectedId.value = s.id
  if (settings().autoTranslate) translateMissing()
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
  if (!current.value) return
  const parts = newTagText.value.split(',').map((t) => t.trim()).filter(Boolean)
  for (const p of parts) addTag(current.value, p)
  newTagText.value = ''
  if (settings().autoTranslate) translateMissing()
}

// Pull English tags that lack a Chinese gloss and translate them via Grok,
// caching results into the shared dictionary.
async function translateMissing() {
  const set = current.value
  if (!set) return
  const pending = set.tags.filter((t) => t.en && !t.zh)
  if (!pending.length) { flash('没有需要翻译的标签'); return }
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

async function retranslateAll() {
  const set = current.value
  if (!set) return
  busyMsg.value = `重翻 ${set.tags.length} 个标签…`
  try {
    const map = await translateTags(settings().model, set.tags.map((t) => t.en))
    for (const t of set.tags) {
      const zh = map[t.en] || map[t.en.toLowerCase()]
      if (zh) { t.zh = zh; remember(t.en, zh) }
    }
    touch(set)
    flash('已重新翻译')
  } catch (e: any) {
    flash('翻译失败：' + (e?.message || e))
  } finally {
    busyMsg.value = ''
  }
}

async function copyPrompt(headers = true) {
  if (!current.value) return
  await navigator.clipboard.writeText(promptText(current.value, headers))
  flash(headers ? '已复制（带分段标题）' : '已复制（单行）')
}

// Chips grouped by section so the 【Section】 layout is visible while editing.
const groups = computed(() => (current.value ? groupTags(current.value.tags) : []))
const hasSections = computed(() => !!current.value?.tags.some((t) => t.section))
const sectionNames = computed(() => [...new Set((current.value?.tags || []).map((t) => t.section).filter(Boolean))] as string[])

// ---- tag bulk ops ----
const tagMode = ref(false)
const tagSel = ref<string[]>([])
watch(selectedId, () => { tagSel.value = [] })
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

function applyGenerated(p: { name: string; prefix: string; sections: GenSection[]; negative: string[]; regions?: Region[]; canvas?: { w: number; h: number } }) {
  const set = newSet(p.name || '生成')
  if (p.regions?.length) { set.regions = p.regions; set.canvas = p.canvas; showLayout.value = true }
  set.tags = buildTags(p.prefix, p.sections)
  set.negative = p.negative.join(', ')
  doc.sets.unshift(set)
  selectedId.value = set.id
  showGen.value = false
  if (settings().autoTranslate) translateMissing()
}

// ---- layout (bboxes) on the current set ----
const showLayout = ref(false)
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
  await navigator.clipboard.writeText(bboxJson(current.value))
  flash('已复制框坐标 JSON')
}

// ---- generate dialog launcher (rewrite mode prefilled with current prompt) ----
const genMode = ref<GenMode>('theme')
const genRaw = ref('')
function openGen(mode: GenMode = 'theme') {
  genMode.value = mode
  genRaw.value = mode === 'rewrite' && current.value ? promptText(current.value, false) : ''
  showGen.value = true
}

const xfer = ref<'' | 'export' | 'import'>('')
const xferIds = ref<string[]>([])
function openXfer(mode: 'export' | 'import', ids: string[] = []) {
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
  if (!current.value) return
  current.value.tags = tagsFromPrompt(rawText.value, lookup)
  touch(current.value)
  rawEdit.value = false
  if (settings().autoTranslate) translateMissing()
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <span class="brand">Prompt Studio<small>V{{ APP_VERSION }}</small></span>
      <span class="spacer" />
      <span v-if="busyMsg" class="muted">{{ busyMsg }}</span>
      <button class="primary" @click="openGen('theme')">✨ 一键生成</button>
      <div class="btn-group">
        <button @click="openXfer('import')">导入</button>
        <button @click="openXfer('export')">导出</button>
      </div>
      <div class="btn-group" title="主题">
        <button v-for="t in THEMES" :key="t.id" :class="{ on: ui.theme === t.id }" @click="ui.theme = t.id">{{ t.label }}</button>
      </div>
      <div class="btn-group" title="界面缩放（也可以用浏览器 Ctrl+滚轮）">
        <button @click="zoom(-10)">A−</button>
        <button title="恢复 100%" @click="zoom(0)">{{ ui.scale }}%</button>
        <button @click="zoom(10)">A＋</button>
      </div>
      <button class="ghost" :title="ui.asideOpen ? '收起右侧面板' : '展开右侧面板'" @click="ui.asideOpen = !ui.asideOpen">
        {{ ui.asideOpen ? '⇥ 收起侧栏' : '⇤ 返图/AI' }}</button>
      <button class="ghost" title="设置" @click="showSettings = true">⚙️</button>
    </header>

    <div class="body">
      <Sidebar v-model:selected="selectedId" @toast="flash" @export="openXfer('export', $event)" />
      <div class="splitter" title="拖动调整宽度" @pointerdown="startSide" @dblclick="ui.sideW = 280" />

      <main v-if="current" class="main">
        <div class="row wrap">
          <button class="ghost" :style="{ color: current.favorite ? 'var(--star)' : '' }" title="收藏"
            @click="current.favorite = !current.favorite; touch(current!)">{{ current.favorite ? '★' : '☆' }}</button>
          <input v-model="current.name" class="title-input" @change="touch(current!)" />
          <select v-model="current.category" :class="current.category ? 'r-' + current.category : ''" style="width: auto" @change="touch(current!)">
            <option :value="undefined">未分级</option>
            <option v-for="c in CATEGORIES" :key="c" :value="c">{{ RATING_LABEL[c] }}</option>
          </select>
          <div class="btn-group">
            <button @click="duplicateSet(current.id)">复制组</button>
            <button class="danger" @click="delSet(current)">删除组</button>
          </div>
        </div>
        <div class="row wrap" style="margin-top: 6px; gap: 6px">
          <input v-model="current.folder" list="folder-list" placeholder="📁 文件夹，如 角色/hanabi" style="width: 200px" @change="touch(current!)" />
          <datalist id="folder-list"><option v-for="f in folders" :key="f" :value="f" /></datalist>
          <span v-for="l in current.labels || []" :key="l" class="pill on" title="点击移除" @click="dropLabel(l)">{{ l }} ×</span>
          <input v-model="labelText" placeholder="＋标签，回车添加" style="width: 130px" @keydown.enter="addLabel" />
        </div>

        <section class="section">
          <div class="section-head">
            <button class="collapse-btn" :title="ui.tagsOpen ? '收起标签' : '展开标签'" @click="ui.tagsOpen = !ui.tagsOpen">{{ ui.tagsOpen ? '▾' : '▸' }}</button>
            <h4 style="cursor: pointer" @click="ui.tagsOpen = !ui.tagsOpen">标签</h4>
            <span class="badge">{{ current.tags.length }}</span>
            <span class="spacer" />
            <div class="btn-group">
              <button @click="translateMissing">翻译未译</button>
              <button @click="retranslateAll">全部重翻</button>
            </div>
            <div class="btn-group">
              <button @click="openRaw">编辑原文</button>
              <button @click="openGen('rewrite')">AI 改写格式</button>
              <button :class="{ on: showLayout }" @click="ensureLayout">画框布局</button>
            </div>
            <div class="btn-group">
              <button @click="copyPrompt(true)">复制(分段)</button>
              <button @click="copyPrompt(false)">复制(单行)</button>
            </div>
            <button :class="tagMode ? 'primary' : ''" @click="tagMode = !tagMode; tagSel = []">
              {{ tagMode ? '退出批量' : '批量编辑' }}</button>
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
              @dragstart="onGroupDragStart(gi, $event)" @dblclick="renameSection(g)">
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
              <div v-for="t in g.tags" :key="t.id" draggable="true"
                :class="['chip-wrap', { sel: tagSel.includes(t.id) }]"
                @dragstart.stop="onTagDragStart(t, $event)" @dragover.prevent
                @drop.prevent.stop="onTagDrop(t, $event)" @click="tagMode && toggleTagSel(t.id)">
                <TagChip :tag="t" @remove="removeTag(current!, t.id)" @change="touch(current!)" />
              </div>
            </div>
          </div>

          <div class="row" style="margin-top: 10px">
            <input v-model="newTagText" placeholder="添加标签，可用逗号一次加多个…" style="flex: 1" @keydown.enter="onAddTag" />
            <button class="primary" @click="onAddTag">添加</button>
          </div>
          <p class="hint">双击中/英文修改（输入框随内容变大，Enter 确认）；拖动标签排序或拖到其他分区；拖动分区标题调整顺序，双击标题改名。</p>
          </template>
        </section>

        <section v-if="showLayout && current.regions && current.canvas" class="section">
          <div class="section-head">
            <h4>画框布局（区域提示词）</h4>
            <span class="badge">{{ current.regions.length }} 个框</span>
            <span class="spacer" />
            <button @click="copyBboxes">复制框坐标 JSON</button>
            <button class="ghost" @click="showLayout = false">收起</button>
          </div>
          <LayoutPanel :regions="current.regions" :canvas="current.canvas" @change="touch(current!)" />
        </section>

        <section class="section">
          <div class="section-head"><h4>负向提示词</h4></div>
          <textarea v-model="current.negative" rows="2" placeholder="nsfw, worst quality, bad anatomy…" @change="touch(current!)" />
        </section>

        <section class="section">
          <div class="section-head">
            <button class="collapse-btn" @click="showOut = !showOut">{{ showOut ? '▾' : '▸' }}</button>
            <h4 style="cursor: pointer" @click="showOut = !showOut">正向提示词（输出预览）</h4>
            <span class="spacer" />
            <button class="ghost" @click="copyPrompt(true)">复制</button>
          </div>
          <textarea v-if="showOut" class="out-box" :value="promptText(current)" rows="10" readonly />
        </section>
      </main>
      <main v-else class="main muted" style="display: grid; place-items: center">左侧新建或选择一个提示词组</main>

      <template v-if="current && ui.asideOpen">
        <div class="splitter right" title="拖动调整宽度，双击恢复" @pointerdown="startAside" @dblclick="ui.asideW = 360" />
        <aside class="aside">
          <Gallery :set="current" @toast="flash" @review="aiRef?.reviewImage($event)"
            @reverse="aiRef?.reverseImage($event)" @import-meta="importMeta" />
          <AiTools ref="aiRef" :set="current" @toast="flash" @select="selectedId = $event" />
        </aside>
      </template>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <!-- raw edit modal -->
    <div v-if="rawEdit" class="modal-mask" @click.self="rawEdit = false">
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
        <h3 style="margin-top: 0">设置</h3>
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
            <input v-model.number="doc.settings.maxImages" type="number" min="1" max="10" style="width: 80px; margin-left: 6px" />
          </label>
          <label>
            框坐标 JSON 格式
            <select v-model.number="doc.settings.bboxScale" style="width: auto; margin-left: 6px">
              <option :value="1000">0–1000 整数</option>
              <option :value="1">0–1 小数</option>
            </select>
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

    <TransferDialog v-if="xfer" :mode="xfer" :preselect="xferIds" :current="selectedId"
      @close="xfer = ''" @toast="flash" @select="selectedId = $event" />
    <Credits />
    <GenerateDialog v-if="showGen" :initial-mode="genMode" :initial-raw="genRaw" @close="showGen = false" @apply="applyGenerated" />
  </div>
</template>
