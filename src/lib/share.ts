// Online sharing without a server of our own:
//  1) Share code: sets → JSON → deflate → base64url, prefixed "PS1.". Paste it
//     anywhere (chat, forum, QQ). Fully offline, free, nothing uploaded.
//  2) GitHub Gist: optional, uses the user's own GitHub token to publish a
//     secret gist; anyone with the link can import it (reading needs no token).
// Images and settings (API address / key) are never included.
import type { PromptSet, Tag, Region, Category } from './types'
import { CATEGORIES } from './types'
import { uid } from './tags'

const PREFIX = 'PS1.'
const GIST_FILE = 'prompt-studio.json'
const TOKEN_KEY = 'prompt-studio-gist-token' // kept apart from doc so it is never exported

interface SlimSet {
  name: string; category?: Category; folder?: string; labels?: string[]
  tags: Array<{ en: string; zh?: string; w?: number; s?: string }>
  negative?: string; regions?: Array<Omit<Region, 'id'>>; canvas?: { w: number; h: number }
}
interface Pack { app: 'prompt-studio'; v: 1; sets: SlimSet[] }

export interface ShareOpts { zh: boolean; regions: boolean; meta: boolean }
export const DEFAULT_SHARE: ShareOpts = { zh: true, regions: true, meta: true }

function slim(s: PromptSet, o: ShareOpts = DEFAULT_SHARE): SlimSet {
  return {
    name: s.name, category: s.category, folder: o.meta ? s.folder || undefined : undefined, labels: o.meta && s.labels?.length ? s.labels : undefined,
    tags: s.tags.map((t) => ({ en: t.en, zh: o.zh ? t.zh || undefined : undefined, w: t.weight !== 1 ? t.weight : undefined, s: t.section || undefined })),
    negative: s.negative || undefined,
    regions: o.regions && s.regions?.length ? s.regions.map(({ x, y, w, h, text }) => ({ x, y, w, h, text })) : undefined,
    canvas: o.regions && s.regions?.length ? s.canvas : undefined,
  }
}

// ---- base64url + deflate ----
function toB64u(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64u(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}
async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(t))
  return new Uint8Array(await out.arrayBuffer())
}

function packJson(sets: PromptSet[], o?: ShareOpts): string {
  const p: Pack = { app: 'prompt-studio', v: 1, sets: sets.map((x) => slim(x, o)) }
  return JSON.stringify(p)
}

export async function makeShareCode(sets: PromptSet[], o?: ShareOpts): Promise<string> {
  const raw = new TextEncoder().encode(packJson(sets, o))
  return PREFIX + toB64u(await pipe(raw, new CompressionStream('deflate-raw')))
}

// ---- receive: validate untrusted input into fresh PromptSets ----
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')
const num01 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0 }

function toSets(obj: any): PromptSet[] {
  if (!obj || obj.app !== 'prompt-studio' || !Array.isArray(obj.sets)) throw new Error('不是 Prompt Studio 的分享内容')
  const now = Date.now()
  return obj.sets.slice(0, 500).map((s: any): PromptSet => {
    const tags: Tag[] = (Array.isArray(s?.tags) ? s.tags : []).slice(0, 1000).map((t: any) => {
      const w = Number(t?.w)
      return { id: uid(), en: str(t?.en, 300), zh: str(t?.zh, 300), weight: Number.isFinite(w) && w > 0 && w <= 3 ? w : 1,
        section: str(t?.s, 80) || undefined }
    }).filter((t: Tag) => t.en)
    const regions: Region[] = (Array.isArray(s?.regions) ? s.regions : []).slice(0, 50).map((r: any) => {
      const x = num01(r?.x), y = num01(r?.y)
      return { id: uid('r'), x, y, w: Math.min(1 - x, num01(r?.w)), h: Math.min(1 - y, num01(r?.h)), text: str(r?.text, 1000) }
    })
    const cw = Number(s?.canvas?.w), ch = Number(s?.canvas?.h)
    return {
      id: uid('s'), name: str(s?.name, 80) || '分享的提示词',
      category: CATEGORIES.includes(s?.category) ? s.category : undefined,
      folder: str(s?.folder, 120) || undefined,
      labels: Array.isArray(s?.labels) ? s.labels.map((l: unknown) => str(l, 40)).filter(Boolean).slice(0, 30) : undefined,
      tags, negative: str(s?.negative, 4000),
      regions: regions.length ? regions : undefined,
      canvas: regions.length && cw > 0 && ch > 0 && cw <= 8192 && ch <= 8192 ? { w: Math.round(cw), h: Math.round(ch) } : regions.length ? { w: 1024, h: 1024 } : undefined,
      createdAt: now, updatedAt: now,
    }
  })
}

const GIST_RE = /(?:gist\.github(?:usercontent)?\.com\/(?:[\w-]+\/)?)?([0-9a-f]{20,40})/i

// Accepts a share code, a gist link / id, or raw shared JSON.
export async function readShared(input: string): Promise<PromptSet[]> {
  const t = input.trim()
  if (!t) throw new Error('请粘贴分享码或链接')
  const code = t.match(/PS1\.[A-Za-z0-9_-]+/)?.[0]
  if (code) {
    const bytes = await pipe(fromB64u(code.slice(PREFIX.length)), new DecompressionStream('deflate-raw'))
    if (bytes.length > 20_000_000) throw new Error('内容过大')
    return toSets(JSON.parse(new TextDecoder().decode(bytes)))
  }
  if (t.startsWith('{')) return toSets(JSON.parse(t))
  const id = t.match(GIST_RE)?.[1]
  if (id) return toSets(JSON.parse(await fetchGist(id)))
  throw new Error('认不出来：请粘贴 PS1. 开头的分享码，或 Gist 链接')
}

// ---- GitHub Gist (optional) ----
export const gistToken = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (v: string) => (v ? localStorage.setItem(TOKEN_KEY, v.trim()) : localStorage.removeItem(TOKEN_KEY)),
}

async function fetchGist(id: string): Promise<string> {
  const r = await fetch(`https://api.github.com/gists/${id}`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error(`读取 Gist 失败（${r.status}）${r.status === 404 ? '：链接不存在或已删除' : r.status === 403 ? '：访问太频繁，稍后再试' : ''}`)
  const g = await r.json()
  const f = g?.files?.[GIST_FILE] || Object.values(g?.files || {})[0] as any
  if (!f) throw new Error('Gist 里没有文件')
  if (f.truncated && f.raw_url) {
    const raw = await fetch(f.raw_url)
    if (!raw.ok) throw new Error('读取 Gist 原文失败')
    return raw.text()
  }
  return String(f.content || '')
}

export async function publishGist(sets: PromptSet[], desc: string, o?: ShareOpts): Promise<string> {
  const token = gistToken.get()
  if (!token) throw new Error('先填 GitHub Token（只需要 gist 权限）')
  const r = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: desc || 'Prompt Studio 分享', public: false, files: { [GIST_FILE]: { content: packJson(sets, o) } } }),
  })
  if (r.status === 401) throw new Error('Token 无效或已过期')
  if (!r.ok) throw new Error(`发布失败（${r.status}）`)
  const g = await r.json()
  return String(g.html_url || '')
}
