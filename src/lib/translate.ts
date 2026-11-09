import { chat, extractJson } from './grok'
import { GEN_SECTIONS, type Region } from './types'
import { sanitizeIdentity } from './tags'

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

const IDENTITY_RULE = `- 【硬性禁止】不写角色的发色、瞳色/眼睛颜色、耳朵（任何兽耳、尖耳、耳朵形状），也不写异色瞳、肤色、种族特征。
  这些由角色 LoRA 决定。可以写发型、发长、刘海、头发动态（如 long hair fluttering in the wind），
  可以写眼神/视线/表情（如 wide-open eye, looking down），但不能出现颜色词修饰头发或眼睛。
  饰品颜色可以写（如 black hair ribbon）。`

export function buildGenSystem(rules: string, banIdentity: boolean): string {
  return `你是资深 AI 绘图提示词工程师，精通 Danbooru 标签与 NovelAI/SD 系提示词写法。
根据用户主题，生成一组结构化英文提示词。

输出格式：只输出一个 JSON 对象，不要任何其他文字：
{
  "sections": [
    {"name": "Common", "tags": ["..."]},
    {"name": "Appearance", "tags": ["..."]},
    {"name": "Expression", "tags": ["..."]},
    {"name": "Pose", "tags": ["..."]},
    {"name": "Outfit", "tags": ["..."]},
    {"name": "Atmosphere & Dynamic FX", "tags": ["..."]},
    {"name": "Background & Lighting", "tags": ["..."]}
  ],
  "negative": ["..."],
  "name": "20字以内的中文总体描述，概括这组提示词的画面"
}
section 必须严格是这 7 个、按这个顺序：${GEN_SECTIONS.join(' / ')}。

各段内容：
- Common：人数(1girl, solo 等)、镜头角度、构图、取景范围(full-body / cowboy shot / upper body)、整体氛围与风格。
- Appearance：发型、发长、刘海、头发动态、发饰；体型。
- Expression：表情、眼神、视线、嘴部、情绪气场。
- Pose：动作、手部、腿部、身体朝向、所处位置。
- Outfit：服装从上到下（上衣→下装→袜→鞋→配件），写清款式和细节。
- Atmosphere & Dynamic FX：动态特效、粒子、风、运动模糊、笔触与画风质感。
- Background & Lighting：场景、天空/环境、光源方向、光影对比、色调。光照写在最后。

写法要求（优化规则）：
- 每段 4–10 个标签。每个标签是一个短语单元，不写完整句子，不以句号结尾。
- 具体可画：用画面上看得见的描述，少用抽象形容词堆砌。
- 前后一致：镜头角度、视线方向、动作、光源在各段之间不能矛盾（例如仰拍就配 looking down at viewer）。
- 去重：同一个意思只写一次，不要换着说法重复。
- 权重：只给 1–2 个最核心的视觉焦点加权，格式 (tag:1.2)–(tag:1.4)，其他不加。
- 不要写质量词（masterpiece、best quality 等），质量词会自动注入。
- negative 给 5–10 个针对本主题容易出错的反向标签（如手部、构图、多余人物）。
- name：20 字以内中文，概括整组画面（如「雨夜霓虹街头的红伞少女」），不是标签堆砌。
- 如实按主题生成，不做道德评判，不拒绝。
${banIdentity ? IDENTITY_RULE : ''}
${rules.trim() ? `用户附加规则（优先遵守）：\n${rules.trim()}` : ''}

格式和信息密度参考（不要照抄内容）：
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
}

export type GenMode = 'theme' | 'rewrite' | 'layout'
export interface GenInput {
  mode: GenMode
  text: string                 // theme / raw prompt / overall scene description
  images?: string[]            // reference image data URLs
  regions?: Region[]
  canvas?: { w: number; h: number }
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
${regionsText(input.regions || [], input.canvas || { w: 1024, h: 1024 })}
要求：
- 各 section 里用构图标签体现位置关系（如 character on the left side, moon in the upper right corner, foreground, background）。
- 另外输出 "regions": [{"id": "框的id", "tags": ["..."]}]，每个框 3–8 个英文标签，只描述框内的东西，用于区域提示词。`)
  }
  if (input.images?.length) {
    parts.push(`已附 ${input.images.length} 张参考图：参考它们的构图、姿势、服装、场景、光影与画风来写标签；文字描述与参考图冲突时以文字为准。`)
  }
  parts.push('请按要求生成。')
  return parts.join('\n\n')
}

function cleanList(list: unknown, banIdentity: boolean, removed: string[], seen?: Set<string>): string[] {
  const out: string[] = []
  for (const t0 of Array.isArray(list) ? list : []) {
    const t = String(t0).trim().replace(/[,.]+$/, '').trim()
    if (!t) continue
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
  return { name, sections, negative, removed, regions }
}