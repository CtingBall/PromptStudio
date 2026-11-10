<script setup lang="ts">
// AI actions on the current set: free-form edit, quick actions, variants,
// auto-classify, prompt/result-image review, reverse prompt. Every change can be undone.
// Every async action captures its target set up-front, so switching sets mid-run
// can never write the result onto the wrong set.
import { ref } from 'vue'
import type { PromptSet, Tag } from '../lib/types'
import { doc, touch, promptText, buildTags, dedupe, settings, newSet, folders, allLabels } from '../lib/store'
import { aiEdit, aiVariants, aiClassify, aiReview, aiCritique, translateSetMissing, QUICK_ACTIONS, ctxOf, type ReviewResult } from '../lib/ai'
import { boxesToRegions } from '../lib/layout'
import type { Region } from '../lib/types'
import { generateSet, type GenResult } from '../lib/translate'
import { getImage } from '../lib/imagedb'

const props = defineProps<{ set: PromptSet }>()
const emit = defineEmits<{ (e: 'select', id: string): void; (e: 'toast', msg: string): void }>()

const instruction = ref('')
const nVar = ref(1)
const busy = ref('')
const note = ref('')
const undo = ref<{ id: string; tags: Tag[]; negative: string; name: string; regions?: Region[] } | null>(null)
const review = ref<ReviewResult | null>(null)
const reviewSet = ref<PromptSet | null>(null) // the set the current review was made for

// Run fn with the set captured NOW; nothing inside reads props.set after an await.
async function job(label: string, fn: (set: PromptSet) => Promise<void>) {
  if (busy.value) { emit('toast', '正在执行：' + busy.value); return }
  const set = props.set
  busy.value = label
  note.value = ''
  try { await fn(set) } catch (e: any) { emit('toast', label + '失败：' + (e?.message || e)) } finally { busy.value = '' }
}

function withNeg(base: string, r: GenResult) { return dedupe([...base.split(','), ...r.negative]).join(', ') }

function apply(set: PromptSet, r: GenResult) {
  if (!r.sections.length) throw new Error('模型没有返回可用的标签')
  undo.value = { id: set.id, tags: JSON.parse(JSON.stringify(set.tags)), negative: set.negative, name: set.name,
    regions: set.regions ? JSON.parse(JSON.stringify(set.regions)) : undefined }
  set.tags = buildTags(settings().genPrefix, r.sections)
  if (set.regions?.length && r.boxes.length) set.regions = boxesToRegions(r.boxes, 0)
  if (r.negative.length) set.negative = withNeg(settings().genNegative, r)
  if (r.name && /^(未命名|生成|示例|返图|布局|参考图)/.test(set.name)) set.name = r.name
  touch(set)
  if (r.removed.length) note.value = '已过滤：' + r.removed.join('；')
  if (settings().autoTranslate) translateSetMissing(set).catch(() => {})
}
function undoLast() {
  const u = undo.value
  const s = doc.sets.find((x) => x.id === u?.id)
  if (!u || !s) return
  s.tags = u.tags
  s.negative = u.negative
  s.name = u.name
  if (u.regions) s.regions = u.regions
  touch(s)
  undo.value = null
}

function addSetFrom(from: PromptSet, r: GenResult, name: string): PromptSet {
  const s = newSet(r.name || name)
  s.tags = buildTags(settings().genPrefix, r.sections)
  s.negative = withNeg(settings().genNegative, r)
  s.category = from.category
  s.folder = from.folder
  s.labels = from.labels ? [...from.labels] : undefined
  if (from.regions?.length) {
    s.regions = r.boxes.length ? boxesToRegions(r.boxes, 0) : JSON.parse(JSON.stringify(from.regions))
    s.canvas = from.canvas ? { ...from.canvas } : undefined
  }
  if (from.chars) s.chars = JSON.parse(JSON.stringify(from.chars))
  doc.sets.unshift(s)
  if (settings().autoTranslate) translateSetMissing(s).catch(() => {})
  return s
}

const run = (text: string) => job('AI 修改', async (set) => {
  apply(set, await aiEdit(promptText(set, true), set.negative, text, undefined, 0.5, ctxOf(set)))
})
const variants = () => job('生成变体', async (set) => {
  const n = Math.min(8, Math.max(1, Math.round(Number(nVar.value) || 1)))
  nVar.value = n
  const rs = await aiVariants(promptText(set, true), set.negative, n, instruction.value.trim(), ctxOf(set))
  if (!rs.length) throw new Error('没有成功的变体')
  rs.forEach((r, i) => addSetFrom(set, r, `${set.name} 变体${i + 1}`))
  emit('toast', `已新建 ${rs.length} 个变体组`)
})
const classify = () => job('AI 整理', async (set) => {
  const r = await aiClassify(promptText(set, true), folders.value, allLabels.value)
  if (r.rating) set.category = r.rating
  if (r.folder) set.folder = r.folder
  set.labels = [...new Set([...(set.labels || []), ...r.labels])]
  if (r.name) set.name = r.name
  touch(set)
  note.value = r.reason
})
const critique = () => job('提示词诊断', async (set) => {
  reviewSet.value = set
  review.value = await aiCritique(promptText(set, true), set.negative, ctxOf(set))
})

// called from App when the gallery asks for it
function reviewImage(id: string) {
  return job('返图诊断', async (set) => {
    const img = await getImage(id)
    if (!img) throw new Error('找不到图片')
    reviewSet.value = set
    review.value = await aiReview(promptText(set, true), set.negative, img, ctxOf(set))
  })
}
function reverseImage(id: string) {
  return job('反推', async (set) => {
    const img = await getImage(id)
    if (!img) throw new Error('找不到图片')
    const s0 = settings()
    const r = await generateSet(s0.model, { mode: 'theme', text: instruction.value.trim(), images: [img] },
      { rules: s0.genRules, banIdentity: s0.banIdentity })
    const s = addSetFrom(set, r, `${set.name} 反推`)
    s.shots = [{ id, at: Date.now() }]
    emit('select', s.id)
  })
}
defineExpose({ reviewImage, reverseImage })
</script>

<template>
  <div class="card">
    <div class="card-head">
      <strong>✨ AI 工具</strong>
      <span class="spacer" />
      <span v-if="busy" class="muted" style="font-size: 12px">{{ busy }}中…</span>
      <button v-if="undo && undo.id === set.id && !busy" class="ghost sm" @click="undoLast">↶ 撤销上次 AI 修改</button>
    </div>

    <textarea v-model="instruction" rows="2"
      placeholder="用一句话说想怎么改，例如「改成雨夜，加霓虹反光」「人物改成坐姿，镜头拉近到半身」" />
    <div class="row" style="margin-top: 6px; gap: 6px">
      <button class="primary" :disabled="!!busy || !instruction.trim()" @click="run(instruction.trim())">按描述修改</button>
      <span class="spacer" />
      <input v-model.number="nVar" type="number" min="1" max="8" style="width: 52px" />
      <button :disabled="!!busy" title="用上面的描述作为变化方向（可留空）" @click="variants">生成变体组</button>
    </div>

    <div class="pills" style="margin-top: 8px">
      <span v-for="a in QUICK_ACTIONS" :key="a.label" class="pill" :class="{ off: !!busy }" :title="a.text"
        @click="!busy && run(a.text)">{{ a.label }}</span>
      <span class="pill" :class="{ off: !!busy }" title="给提示词打分并给改进建议（不需要图）" @click="!busy && critique()">🔍 诊断提示词</span>
      <span class="pill" :class="{ off: !!busy }" title="AI 判断分级、文件夹、标签、名称" @click="!busy && classify()">🏷 自动分级整理</span>
    </div>
    <p v-if="note" class="muted" style="font-size: 12px; margin: 6px 0 0">{{ note }}</p>

    <div v-if="review" class="review">
      <div class="row">
        <strong>诊断</strong>
        <span v-if="reviewSet" class="muted" style="font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
          :style="{ color: reviewSet.id !== set.id ? 'var(--c-sfw)' : '' }">针对：{{ reviewSet.name }}</span>
        <span class="score" :style="{ color: review.score >= 75 ? 'var(--accent2)' : review.score >= 50 ? 'var(--c-sfw)' : 'var(--danger)' }">
          {{ review.score }} 分</span>
        <span class="spacer" />
        <button class="ghost sm" @click="review = null">✕</button>
      </div>
      <p style="margin: 6px 0">{{ review.summary }}</p>
      <div v-if="review.missing.length"><b>缺失/不足：</b>{{ review.missing.join('；') }}</div>
      <div v-if="review.extra.length"><b>问题：</b>{{ review.extra.join('；') }}</div>
      <ul v-if="review.suggestions.length" style="margin: 6px 0; padding-left: 18px">
        <li v-for="(x, i) in review.suggestions" :key="i">{{ x }}</li>
      </ul>
      <div class="row" style="gap: 6px">
        <button class="primary" :disabled="!review.fix.sections.length" @click="reviewSet && apply(reviewSet, review.fix); review = null">应用修正版（可撤销）</button>
        <button :disabled="!review.fix.sections.length" @click="reviewSet && addSetFrom(reviewSet, review.fix, reviewSet.name + ' 修正'); review = null">另存为新组</button>
      </div>
    </div>
  </div>
</template>
