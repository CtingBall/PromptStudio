// Civitai (C站) helpers: import images by link (prompt + params + the image itself)
// and write a set's prompt in the A1111 "parameters" text that Civitai reads.
import type { PromptSet } from './types'
import { genInfo } from './pngmeta'

// all network goes through the app's /net/get forwarder (Civitai blocks browser CORS)
async function get(url: string): Promise<Response> {
  const r = await fetch('/net/get?url=' + encodeURIComponent(url))
  if (!r.ok) throw new Error(`C站请求失败 ${r.status}：${(await r.text()).slice(0, 120)}`)
  return r
}

/** Image ids from pasted text: civitai.com/images/123, ?imageId=123, or bare numbers. */
export function civitaiImageIds(text: string): string[] {
  const ids = new Set<string>()
  for (const m of text.matchAll(/civitai\.(?:com|green)\/images\/(\d+)/gi)) ids.add(m[1])
  for (const m of text.matchAll(/[?&]imageId=(\d+)/gi)) ids.add(m[1])
  if (!ids.size) for (const m of text.matchAll(/\b(\d{4,})\b/g)) ids.add(m[1])
  return [...ids]
}

export interface CivitaiImage { id: string; url: string; meta: string; nsfw: string; page: string }

/** Civitai API meta → A1111 parameters text, so the normal parser handles it. */
export function metaToParameters(m: Record<string, any>): string {
  if (!m?.prompt) return ''
  const p: string[] = []
  const add = (k: string, v: unknown) => { if (v != null && v !== '') p.push(`${k}: ${String(v).includes(',') ? JSON.stringify(String(v)) : v}`) }
  add('Steps', m.steps); add('Sampler', m.sampler); add('Schedule type', m.scheduler); add('CFG scale', m.cfgScale)
  add('Seed', m.seed); add('Size', m.Size); add('Model', m.Model); add('Denoising strength', m.denoise ?? m['Denoising strength'])
  const loras = (m.resources || m.civitaiResources || []).filter((r: any) => /lora|lycoris|locon/i.test(r.type || r.modelType || '') && (r.name || r.modelName))
  if (loras.length) add('Lora hashes', loras.map((r: any) => `${r.name || r.modelName}: ${r.hash || r.weight || 1}`).join(', '))
  if (!m.Model) {
    const ck = (m.resources || []).find((r: any) => /model|checkpoint/i.test(r.type || ''))
    if (ck?.name) add('Model', ck.name)
  }
  // keep <lora:name:w> visible in the prompt so weights survive
  const tagLoras = loras.filter((r: any) => r.weight != null && !new RegExp(`<lora:${(r.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(m.prompt))
    .map((r: any) => `<lora:${r.name || r.modelName}:${r.weight}>`).join(' ')
  return `${m.prompt}${tagLoras ? ', ' + tagLoras : ''}\n${m.negativePrompt ? 'Negative prompt: ' + m.negativePrompt + '\n' : ''}${p.join(', ')}`
}

export async function fetchCivitaiImage(id: string): Promise<CivitaiImage> {
  const r = await (await get(`https://civitai.com/api/v1/images?imageId=${id}&nsfw=X&limit=1`)).json()
  const it = r?.items?.[0]
  if (!it) throw new Error(`找不到图片 ${id}（可能已删除或需要登录）`)
  return { id, url: it.url, meta: metaToParameters(it.meta || {}), nsfw: String(it.nsfwLevel ?? it.nsfw ?? ''), page: `https://civitai.com/images/${id}` }
}

export async function fetchImageFile(url: string, name: string): Promise<File> {
  const b = await (await get(url)).blob()
  return new File([b], name, { type: b.type || 'image/jpeg' })
}

/** Civitai nsfw level → our rating. */
export function civitaiRating(n: string): 'SAFE' | 'SFW' | 'NSFW' | undefined {
  const s = n.toLowerCase()
  if (/^(1|none|pg)$/.test(s)) return 'SAFE'
  if (/^(2|soft|pg13)$/.test(s)) return 'SFW'
  if (/^(4|8|16|32|mature|x|xxx|r)$/.test(s)) return 'NSFW'
  return undefined
}

/** Prompt in A1111 format (what Civitai "Add generation data" / post parsing expects). */
export function toParameters(set: PromptSet, prompt: string): string {
  const info = set.shots?.map((s) => genInfo(s.meta)).find(Boolean)
  const p: string[] = []
  if (info?.steps) p.push('Steps: ' + info.steps)
  if (info?.sampler) p.push('Sampler: ' + info.sampler)
  if (info?.cfg != null) p.push('CFG scale: ' + info.cfg)
  if (info?.seed) p.push('Seed: ' + info.seed)
  const size = info?.size || (set.canvas ? `${set.canvas.w}x${set.canvas.h}` : '')
  if (size) p.push('Size: ' + size)
  if (info?.model) p.push('Model: ' + info.model)
  return `${prompt}\n${set.negative ? 'Negative prompt: ' + set.negative + '\n' : ''}${p.join(', ')}`.trim()
}
