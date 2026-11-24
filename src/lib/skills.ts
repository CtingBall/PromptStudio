// Built-in skills: reference books shipped in public/skills/<id>.json (built by
// scripts/build-skill.py). Before an AI generation the most relevant chunks are
// picked by keyword overlap with the request and added to the system prompt.
import { settings } from './store'

export interface SkillInfo { id: string; name: string; desc: string; chunks: number }
interface Chunk { t: string; p: number; x: string }
interface Skill extends SkillInfo { chunks_: Chunk[]; grams: Array<Map<string, number>> }

const BUDGET = 6000 // characters of reference text per request
const cache = new Map<string, Promise<Skill | null>>()
let index: Promise<SkillInfo[]> | null = null

export function listSkills(): Promise<SkillInfo[]> {
  index ??= fetch('/skills/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])
  return index
}

// Chinese is matched by character bigrams, everything else by lower-cased words.
function grams(text: string): Map<string, number> {
  const m = new Map<string, number>()
  const add = (g: string) => m.set(g, (m.get(g) || 0) + 1)
  const s = text.toLowerCase()
  for (const w of s.match(/[a-z][a-z0-9_'-]{2,}/g) || []) add(w)
  for (const run of s.match(/[\u4e00-\u9fff]+/g) || []) {
    for (let i = 0; i < run.length - 1; i++) add(run.slice(i, i + 2))
  }
  return m
}

function load(id: string): Promise<Skill | null> {
  if (!cache.has(id)) {
    cache.set(id, fetch(`/skills/${id}.json`).then(async (r) => {
      if (!r.ok) return null
      const d = await r.json()
      const chunks: Chunk[] = d.chunks || []
      return { ...d, chunks: chunks.length, chunks_: chunks, grams: chunks.map((c) => grams(c.t + '\n' + c.x)) }
    }).catch(() => null))
  }
  return cache.get(id)!
}

// Rank chunks: overlap weighted by rarity (rare words matter more), title hits count double.
function pick(sk: Skill, query: string, budget: number): Chunk[] {
  const q = grams(query)
  if (!q.size) return []
  const df = new Map<string, number>()
  for (const g of q.keys()) df.set(g, sk.grams.reduce((n, m) => n + (m.has(g) ? 1 : 0), 0))
  const N = sk.grams.length
  const scored = sk.chunks_.map((c, i) => {
    let s = 0
    for (const [g, qn] of q) {
      const tf = sk.grams[i].get(g)
      if (!tf) continue
      const idf = Math.log(1 + N / (df.get(g) || 1))
      s += idf * Math.min(tf, 3) * Math.min(qn, 2) * (c.t.toLowerCase().includes(g) ? 2 : 1)
    }
    return { c, s: s / Math.sqrt(30 + c.x.length / 30) }
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
  const out: Chunk[] = []
  let used = 0
  for (const { c } of scored) {
    if (used + c.x.length > budget) continue
    out.push(c); used += c.x.length
    if (used > budget * 0.9) break
  }
  return out.sort((a, b) => a.p - b.p)
}

// Reference block for the system prompt ('' when no skill is enabled or nothing matched).
export async function skillContext(query: string): Promise<string> {
  const ids = settings().skills ?? []
  if (!ids.length || !query.trim()) return ''
  const skills = (await Promise.all(ids.map(load))).filter((s): s is Skill => !!s)
  const parts: string[] = []
  for (const sk of skills) {
    const got = pick(sk, query, Math.floor(BUDGET / skills.length))
    if (got.length) parts.push(`【${sk.name}】\n` + got.map((c) => `〔${c.t || '第' + c.p + '页'}〕\n${c.x}`).join('\n\n'))
  }
  if (!parts.length) return ''
  return `\n\n---\n参考资料（内置技能，按本次主题检索出的相关段落）：
写提示词时优先采用这里给出的标签、写法、组合和权重经验，让结果更专业、更好出图。
只参考和本次主题相关的部分，不要因为资料而加入主题没要求的内容；输出格式仍然按上面的要求。
${parts.join('\n\n')}`
}
