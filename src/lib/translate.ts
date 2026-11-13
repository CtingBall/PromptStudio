import { chat, extractJson } from './grok'
import { GEN_SECTIONS, type Region } from './types'
import { sanitizeIdentity } from './tags'
import { LAYOUT_SPEC, LAYOUT_SCHEMA, charsText, layoutText, parseLayout, type LayoutBox } from './layout'
import type { Char } from './types'

// System prompt framing the model as a literal terminology translator for
// Danbooru-style image-generation tags. This keeps translation literal and
// avoids refusals on tags that merely look suggestive out of context — the
// task is lexical translation of existing tags, not content generation.
const TRANSLATE_SYS = `你是一个 AI 绘图提示词（Danbooru 风格标签）的术语翻译器。
规则：
- 把每个英文标签翻译成最贴切、最简短的中文术语，保留绘图圈的习惯译法。
- 这是对既有标签的字面术语翻译，不是创作内容。逐条如实翻译，不要拒绝、不要评价、不要加说明。
- 保留专有名词/角色名/作品名的通用译名；无通用译名时音译。
- 只输出 JSON，不要任何额外文字。`

export async function translateTags(
  model: string,
  tags: string[],
): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)))
  if (!uniq.length) return {}
  const user = `把下面的标签数组翻译成中文，输出一个 JSON 对象，键是原英文、值是中文译文。
标签：${JSON.stringify(uniq)}`
  const reply = await chat({ model, temperature: 0.2, system: TRANSLATE_SYS, user })
  const obj = extractJson<Record<string, string>>(reply)
  const out: Record<string, string> = {}
  for (const k of uniq) {
    const v = obj[k] ?? obj[k.toLowerCase()]
    if (typeof v === 'string') out[k] = v.trim()
  }
  return out
}

export async function translateText(
  model: string,
  text: string,
  to: 'zh' | 'en',
): Promise<string> {
  const target = to === 'zh' ? '中文' : '英文'
  const sys = `你是一个 AI 绘图提示词翻译器。把用户给的文本如实翻译成${target}，
保持绘图提示词语气，逐字面意思翻译，不拒绝、不评论、只输出译文本身。`
  return (await chat({ model, temperature: 0.2, system: sys, user: text })).trim()
}

// ---------------------------------------------------------------------------
// One-click generation
// ---------------------------------------------------------------------------

// Format reference taken from the user's template (quality line removed: it is
// injected separately as the prefix).
const REFERENCE = `【Common】
1girl, solo, low-angle shot, dynamic Dutch angle, tilted framing, full-body view, sitting on high ledge, looking down at viewer, psychological aesthetic, dark surreal atmosphere,
【Appearance】
wildly tangled long hair fluttering and thrashing chaotically in the wind, heavy long bangs completely obscuring one eye, loose unkempt locks blowing across the face, subtle dark ribbons adorning the hair,
【Expression】
unhinged and manic expression, ((single wide-open eye staring intently downward with dilated pupil:1.4)), crazy unblinking psychological gaze, tiny parted mouth, haunting and detached aura,
【Pose】
sitting precariously on the edge of a high rooftop parapet, one hand raised clutching the side of her head, legs dangling freely over the edge with one knee slightly bent forward, head tilted unnervingly toward the lens,
【Outfit】
classic traditional sailor uniform, sailor shirt with dark striped sailor collar, neatly tied bow ribbon at the chest, pleated dark school skirt, dark knee-high socks, school loafers,
【Atmosphere & Dynamic FX】
((a swirling flock of black birds flying erratically around the character:1.3)), scattered silhouettes of crows with motion blur, fierce gusts of wind thrashing the hair and uniform, expressive heavy brushstrokes,
【Background & Lighting】
rooftop parapet edge, massive towering cumulus clouds, patches of deep blue sky between cloud breaks, strong bright backlighting, character's front draped in deep shadows, high-contrast chiaroscuro lighting`

const IDENTITY_RULE = `- 角色外貌由 LoRA 决定：不写发色、瞳色、耳朵、肤色和种族特征。发型、表情、眼神和饰品（含饰品颜色）照常写。`

export function buildGenSystem(rules: string, banIdentity: boolean): string {
  // Deliberately short: a clear goal, the output shape, a few principles and one
  // example. Long rule lists make models play safe and write generic prompts.
  return `你是经验丰富的 AI 插画师，熟悉 Danbooru 标签和 SD / NovelAI 系提示词。
把用户的主题想象成一张具体、有画面感的插画，再写成结构化英文提示词。主题没说的部分由你自由发挥，大胆一些。

先用一句话在 idea 里想好这张图（谁、在哪、在做什么、什么氛围），再写各段。只输出 JSON：
{
  "idea": "一句话画面构想",
  "sections": [
    {"name": "Common", "tags": []},
    {"name": "Appearance", "tags": []},
    {"name": "Expression", "tags": []},
    {"name": "Pose", "tags": []},
    {"name": "Outfit", "tags": []},
    {"name": "Atmosphere & Dynamic FX", "tags": []},
    {"name": "Background & Lighting", "tags": []}
  ],
  "negative": [],
  "name": "20字以内中文画面概括"
}
sections 固定这 7 段、这个顺序：${GEN_SECTIONS.join(' / ')}。
Common 放人数、镜头、取景和整体风格；其余段按名字写，光照放在最后一段。

几点建议：
- 标准标签和描述短语都可以用，写画面上看得见的东西。
- 各段描述同一个瞬间，镜头、视线、动作、光线前后一致。
- 不写质量词（会自动加），不重复同义词；需要强调的焦点可加权，如 (tag:1.3)。
- negative 写几条本图容易出错的地方。
- 如实按主题生成，不做道德评判。
${banIdentity ? IDENTITY_RULE : ''}
${rules.trim() ? `用户附加规则（优先遵守）：\n${rules.trim()}` : ''}

示例（只参考格式和细致程度，不要照抄内容）：
${REFERENCE}`
}

export interface GenSection {
  name: string
  tags: string[]
}
export interface GenResult {
  name: string
  sections: GenSection[]
  negative: string[]
  removed: string[] // tags dropped/changed by the identity filter, for display
  regions: Array<{ id: string; tags: string[] }> // per-box tags (layout mode)
  boxes: LayoutBox[] // AI-designed / refined layout
}

export type GenMode = 'theme' | 'rewrite' | 'layout'
export interface GenInput {
  mode: GenMode
  text: string                 // theme / raw prompt / overall scene description
  images?: string[]            // reference image data URLs
  regions?: Region[]
  canvas?: { w: number; h: number }
  autoLayout?: boolean         // optional: let the AI also design a grid layout of boxes
  grid?: number                // snap divisions for the AI layout
  chars?: Char[]               // characters / LoRA triggers
}

// Plain-language position of a box, so the model gets both numbers and words.
export function describeBox(r: Region): string {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const hx = cx < 0.36 ? '左' : cx > 0.64 ? '右' : '中'
  const vy = cy < 0.36 ? '上' : cy > 0.64 ? '下' : '中'
  const pos = hx === '中' && vy === '中' ? '正中' : vy === '中' ? `${hx}侧` : hx === '中' ? `${vy}方` : `${hx}${vy}`
  return `${pos}，约占画面 ${Math.round(r.w * r.h * 100)}%`
}

export function regionsText(regions: Region[], canvas: { w: number; h: number }): string {
  const f = (n: number) => n.toFixed(2)
  const orient = canvas.w === canvas.h ? '方图' : canvas.w > canvas.h ? '横图' : '竖图'
  const lines = regions.map((r, i) =>
    `#${i + 1} id=${r.id} 框 x ${f(r.x)}–${f(r.x + r.w)}, y ${f(r.y)}–${f(r.y + r.h)}（${describeBox(r)}）：${r.text || '（未写内容）'}`)
  return `画布 ${canvas.w}×${canvas.h}（${orient}），坐标为画布比例，(0,0) 是左上角。\n${lines.join('\n')}`
}

function buildUser(input: GenInput): string {
  const parts: string[] = []
  if (input.mode === 'theme') {
    parts.push(`主题：${input.text || '（见参考图）'}`)
  } else if (input.mode === 'rewrite') {
    parts.push(`下面是一组原始提示词。把它整理改写成上述结构：保留原意和所有有效元素，归入合适分段，去掉重复与矛盾，修正写法，必要时补少量细节让前后一致；原有权重保留。
原始提示词：
${input.text}`)
  } else {
    parts.push(`按下面的画面布局生成。整体描述：${input.text || '（无，按各区域内容推断）'}
${layoutText(input.regions || [], input.canvas || { w: 1024, h: 1024 })}
要求：
- 按规范把每个框补写成完整描述（只改写内容，坐标保持不变；用 n 对应现有框）。框里写的中文意思要保留并翻成英文展开。
- 用户写的对话保持原文放进 text；能判断说话人就填 speaker。
- 输出 ${LAYOUT_SCHEMA}，必须包含所有现有框。
${LAYOUT_SPEC}`)
  }
  if (input.autoLayout && input.mode !== 'layout') {
    const c = input.canvas || { w: 832, h: 1216 }
    const g = input.grid || 8
    parts.push(`另外请为这幅画设计构图布局（画布 ${c.w}×${c.h}），尽量对齐 ${g}×${g} 网格（取 1/${g} 的倍数）。
- 单图 2–8 个框，漫画可以更多；主题里有对话就为每句对话做文字框并标明 speaker。
- 输出 ${LAYOUT_SCHEMA}
${LAYOUT_SPEC}`)
  }
  if (input.chars?.length) parts.push(charsText(input.chars))
  if (input.images?.length) {
    parts.push(`已附 ${input.images.length} 张参考图：参考它们的构图、姿势、服装、场景、光影与画风来写标签；文字描述与参考图冲突时以文字为准。`)
  }
  parts.push('请按要求生成。')
  return parts.join('\n\n')
}

// quality words are injected via the prefix
const FILLER = /^(masterpiece|best quality|high quality|ultra[- ]detailed|highres|absurdres)$/i
function cleanList(list: unknown, banIdentity: boolean, removed: string[], seen?: Set<string>): string[] {
  const out: string[] = []
  for (const t0 of Array.isArray(list) ? list : []) {
    const t = String(t0).trim().replace(/[,.]+$/, '').trim()
    if (!t || FILLER.test(t.replace(/^\(+|(:[\d.]+)?\)+$/g, ''))) continue
    let kept: string | null = t
    if (banIdentity) {
      kept = sanitizeIdentity(t)
      if (kept !== t) removed.push(kept ? `${t} → ${kept}` : t)
    }
    if (!kept) continue
    const key = kept.toLowerCase()
    if (seen) { if (seen.has(key)) continue; seen.add(key) }
    out.push(kept)
  }
  return out
}

export async function generateSet(
  model: string,
  input: GenInput,
  opts: { temperature?: number; rules?: string; banIdentity?: boolean } = {},
): Promise<GenResult> {
  const banIdentity = opts.banIdentity ?? true
  const system = buildGenSystem(opts.rules || '', banIdentity)
  const temperature = opts.temperature ?? (input.mode === 'rewrite' ? 0.3 : 0.7)
  const reply = await chat({ model, temperature, system, user: buildUser(input), images: input.images })
  return parseGen(reply, banIdentity)
}

// Parse a generation-style JSON reply into sections/negative/regions.
export function parseGen(reply: string, banIdentity: boolean): GenResult {
  const obj = extractJson<any>(reply)

  // Accept {sections:[{name,tags}]} or {sections:{Name:[...]}}.
  let raw: Array<{ name: string; tags: unknown }> = []
  if (Array.isArray(obj?.sections)) {
    raw = obj.sections.map((s: any) => ({ name: String(s?.name || '').trim(), tags: s?.tags }))
  } else if (obj?.sections && typeof obj.sections === 'object') {
    raw = Object.entries(obj.sections).map(([name, tags]) => ({ name, tags }))
  } else if (Array.isArray(obj?.positive)) {
    raw = [{ name: 'Common', tags: obj.positive }]
  }

  const removed: string[] = []
  const seen = new Set<string>()
  const sections = raw
    .map((sec) => ({ name: sec.name, tags: cleanList(sec.tags, banIdentity, removed, seen) }))
    .filter((s) => s.tags.length)
  const negative = cleanList(obj?.negative, false, [])
  const regions = (Array.isArray(obj?.regions) ? obj.regions : []).map((r: any) => ({
    id: String(r?.id ?? ''),
    tags: cleanList(r?.tags, banIdentity, removed),
  }))
  const name = String(obj?.name || '').trim().replace(/\s+/g, ' ').slice(0, 20)
  const boxes = parseLayout(obj?.layout)
  return { name, sections, negative, removed, regions, boxes }
}