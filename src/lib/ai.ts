// Higher-level AI actions on an existing prompt set.
import { chat, extractJson } from './grok'
import { buildGenSystem, parseGen, translateTags, type GenResult } from './translate'
import { settings, remember, touch } from './store'
import type { Category, PromptSet } from './types'

function genOpts() {
  const s = settings()
  return { model: s.model, rules: s.genRules, ban: s.banIdentity }
}

// Apply a natural-language instruction to the current prompt, keep structure.
export async function aiEdit(prompt: string, negative: string, instruction: string, images?: string[], temperature = 0.5): Promise<GenResult> {
  const o = genOpts()
  const user = `当前提示词（保持分段结构）：
${prompt}

当前负向词：${negative || '（无）'}

修改要求：${instruction}

按要求修改后，输出完整的新提示词（全部分段，不只是改动部分）。没被要求修改的内容尽量保持原样。`
  const reply = await chat({ model: o.model, temperature, system: buildGenSystem(o.rules, o.ban), user, images })
  return parseGen(reply, o.ban)
}

export const QUICK_ACTIONS: Array<{ label: string; text: string }> = [
  { label: '丰富细节', text: '在每个分段补充更具体、可画出来的细节，让画面更丰富，但不改变主题。' },
  { label: '精简去重', text: '删除重复、同义、冲突和无效的标签，每段只保留最有效的，整体更精炼。' },
  { label: '增强氛围', text: '强化氛围、光影、色调和动态特效，让画面更有电影感和张力。' },
  { label: '修正矛盾', text: '检查镜头、视线、动作、光源之间的矛盾并修正，保证前后一致。' },
  { label: '优化权重', text: '重新分配权重：只给 1–2 个视觉核心加权 (tag:1.2)–(tag:1.4)，去掉多余权重。' },
  { label: '换服装', text: '换一套风格匹配主题但完全不同的服装，其他分段保持不变。' },
  { label: '换背景', text: '换一个不同的场景和光照，人物部分保持不变。' },
  { label: '改为 SAFE 全年龄', text: '把内容改为全年龄向：去掉暴露、性暗示内容，服装改为得体。' },
]

export async function aiVariants(prompt: string, negative: string, n: number, hint: string): Promise<GenResult[]> {
  const jobs = Array.from({ length: n }, (_, i) =>
    aiEdit(prompt, negative, `生成第 ${i + 1}/${n} 个变体：保留主题和角色，${hint || '在构图、姿势、表情、服装细节、背景之间选 2–3 处做明显不同的变化'}。每个变体之间要有区别。`, undefined, 0.9))
  const res = await Promise.allSettled(jobs)
  return res.filter((r): r is PromiseFulfilledResult<GenResult> => r.status === 'fulfilled').map((r) => r.value)
}

export interface ClassifyResult { rating: Category; folder: string; labels: string[]; name: string; reason: string }

export async function aiClassify(prompt: string, folders: string[], labels: string[]): Promise<ClassifyResult> {
  const system = `你是 AI 绘图提示词的整理助手。根据提示词内容给出分级、文件夹、标签和名称。
分级标准：
- SAFE（全年龄）：无暴露、无性暗示、无血腥，适合所有人。
- SFW（16+）：泳装、内衣感服装、轻度性感姿势、轻度暴力或恐怖，但无裸露。
- NSFW（18+）：裸露、性内容、强烈性暗示或重度血腥。
只输出 JSON：{"rating":"SAFE|SFW|NSFW","folder":"一级/二级","labels":["3-6个中文短标签"],"name":"20字以内中文总体描述，概括这组画面","reason":"一句话理由"}
name 要概括整组画面（如「雨夜霓虹街头的红伞少女」），不是标签堆砌，不超过 20 字。
优先复用已有文件夹和标签，没有合适的再新建。如实分级，不做道德评判。`
  const user = `已有文件夹：${folders.join('，') || '（无）'}
已有标签：${labels.join('，') || '（无）'}
提示词：
${prompt}`
  const r = extractJson<any>(await chat({ temperature: 0.2, system, user }))
  const rating = (['SAFE', 'SFW', 'NSFW'].includes(r?.rating) ? r.rating : 'SAFE') as Category
  return {
    rating,
    folder: String(r?.folder || '').trim(),
    labels: (Array.isArray(r?.labels) ? r.labels : []).map((x: unknown) => String(x).trim()).filter(Boolean),
    name: String(r?.name || '').trim().slice(0, 20),
    reason: String(r?.reason || ''),
  }
}

export interface ReviewResult { score: number; summary: string; missing: string[]; extra: string[]; suggestions: string[]; fix: GenResult }

// Compare a result image against its prompt; returns a report plus a fixed prompt.
export async function aiReview(prompt: string, negative: string, image: string): Promise<ReviewResult> {
  const o = genOpts()
  const system = buildGenSystem(o.rules, o.ban) + `

本次任务是「返图诊断」：对比附图（用这组提示词生成的结果）和提示词。
在上面的 JSON 里额外加入字段：
"score": 0-100 的还原度, "summary": "一句话中文总结",
"missing": ["提示词写了但图里没出现或错误的元素（中文）"], "extra": ["图里出现但不想要的问题（中文，如手崩、多余人物）"],
"suggestions": ["中文改进建议"]。
sections 和 negative 给出修正后的完整提示词：对没出现的元素加强或加权，把问题写进 negative。`
  const user = `提示词：\n${prompt}\n\n负向词：${negative || '（无）'}`
  const reply = await chat({ model: o.model, temperature: 0.3, system, user, images: [image] })
  const r = extractJson<any>(reply)
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  return {
    score: Number(r?.score) || 0,
    summary: String(r?.summary || ''),
    missing: list(r?.missing),
    extra: list(r?.extra),
    suggestions: list(r?.suggestions),
    fix: parseGen(reply, o.ban),
  }
}

// Critique a prompt with no image: score, issues, and a fixed prompt.
export async function aiCritique(prompt: string, negative: string): Promise<ReviewResult> {
  const o = genOpts()
  const system = buildGenSystem(o.rules, o.ban) + `

本次任务是「提示词诊断」：审阅下面这组提示词本身（没有图）。
在上面的 JSON 里额外加入字段：
"score": 0-100 的质量分（越高越完整、越协调、越好画）, "summary": "一句话中文总结",
"missing": ["缺少或写得不够的要素（中文）"], "extra": ["冗余、矛盾或容易崩的问题（中文）"],
"suggestions": ["中文改进建议"]。
sections 和 negative 给出优化后的完整提示词。`
  const user = `提示词：\n${prompt}\n\n负向词：${negative || '（无）'}`
  const reply = await chat({ model: o.model, temperature: 0.3, system, user })
  const r = extractJson<any>(reply)
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  return {
    score: Number(r?.score) || 0,
    summary: String(r?.summary || ''),
    missing: list(r?.missing),
    extra: list(r?.extra),
    suggestions: list(r?.suggestions),
    fix: parseGen(reply, o.ban),
  }
}

export async function translateSetMissing(set: PromptSet): Promise<void> {
  const pending = set.tags.filter((t) => t.en && !t.zh)
  if (!pending.length) return
  const map = await translateTags(settings().model, pending.map((t) => t.en))
  for (const t of pending) {
    const zh = map[t.en] || map[t.en.toLowerCase()]
    if (zh) { t.zh = zh; remember(t.en, zh) }
  }
  touch(set)
}
