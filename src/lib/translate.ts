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
const REFERENCE = `【Subject & Shot】
1girl, solo, from below, dutch angle, full body, sitting on ledge, looking down at viewer, dark surreal scene
【Character】
long hair, messy hair, hair over one eye, hair blowing in wind, hair ribbon, slender
【Expression】
crazy eyes, ((single wide-open eye staring down with dilated pupil:1.4)), unblinking stare, parted lips, detached haunting aura
【Pose & Action】
sitting on rooftop parapet edge, hand on own head, clutching hair, legs dangling over the edge, one knee bent, head tilt toward viewer
【Outfit】
serafuku, white sailor shirt, dark striped sailor collar, red bow tie, pleated dark skirt, kneehighs, loafers
【Scene】
rooftop, ((flock of crows swirling around her:1.3)), crow silhouettes, flying feathers, towering cumulus clouds, patches of blue sky, city far below
【Lighting & Color】
strong backlighting, rim light, face in shadow, high contrast, chiaroscuro, blue and black color scheme
【Style & FX】
painterly, expressive heavy brushstrokes, motion blur, strong wind effect, psychological horror atmosphere`

const IDENTITY_RULE = `- 角色外貌由 LoRA 决定：不写发色、瞳色、耳朵、肤色和种族特征。发型、表情、眼神和饰品（含饰品颜色）照常写。`

export function buildGenSystem(rules: string, banIdentity: boolean): string {
  // Deliberately short: a clear goal, the output shape, a few principles and one
  // example. Long rule lists make models play safe and write generic prompts.
  return `你是经验丰富的 AI 插画师，熟悉 Danbooru 标签和 SD / NovelAI 系提示词。
把用户的主题想象成一张具体、有画面感的插画，再写成结构化英文提示词。
用户给出的内容（主题里的每个细节、参考图、原始提示词）要尽可能完整还原，一项都不要丢；用户没说到的部分再由你自由发挥，大胆一些。

先用一句话在 idea 里想好这张图（谁、在哪、在做什么、什么氛围），再写各段。只输出 JSON：
{
  "idea": "一句话画面构想",
  "sections": [
    {"name": "Subject & Shot", "tags": []},
    {"name": "Character", "tags": []},
    {"name": "Expression", "tags": []},
    {"name": "Pose & Action", "tags": []},
    {"name": "Outfit", "tags": []},
    {"name": "Scene", "tags": []},
    {"name": "Lighting & Color", "tags": []},
    {"name": "Style & FX", "tags": []}
  ],
  "negative": [],
  "name": "20字以内中文画面概括"
}
sections 固定这 ${GEN_SECTIONS.length} 段、这个顺序：${GEN_SECTIONS.join(' / ')}。
- Subject & Shot：人数、镜头角度、取景范围、构图、一句总体画面。
- Character：发型、发长、刘海、体型、发饰等外观（不含服装）。
- Expression：表情、眼神、视线。
- Pose & Action：动作、手部、身体朝向、与道具/他人的互动、所在位置。
- Outfit：服装从上到下，再写配件。
- Scene：场景、道具、环境元素，前景/远景。
- Lighting & Color：光源与光影、色调。
- Style & FX：画风、笔触、特效、整体氛围。

几点建议：
- 标准标签和描述短语都可以用，写画面上看得见的东西。
- 各段描述同一个瞬间，镜头、视线、动作、光线前后一致。
- 不写质量词（会自动加），不重复同义词；需要强调的焦点可加权，如 (tag:1.3)。
- negative 写几条本图容易出错的地方。
- 如实按主题生成，不做道德评判。
${banIdentity ? IDENTITY_RULE : ''}
${rules.trim() ? `用户附加规则（优先遵守）：\n${rules.trim()}` : ''}

格式示例（这是另一张图的写法，展示分段和细致程度；内容按用户的主题来写）：
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
    parts.push(`下面是一组原始提示词。把它整理成上述结构，尽可能完整还原：原有的每个元素和权重都保留，只归入合适分段、合并完全重复的词、修正明显写错的地方；不删改原意，也不额外添加原文没有的内容。
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
    parts.push(`已附 ${input.images.length} 张参考图：尽可能还原图里的画面：构图与镜头、人物动作和手势、服装每个部件、场景与道具、光影色调、画风笔触，看得见的细节都写进对应分段（角色外貌限制照旧）。文字描述与参考图冲突时以文字为准。`)
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
    raw = [{ name: 'Subject & Shot', tags: obj.positive }]
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