// Selective, batch import / export of prompt sets, including their result images.
// File format: { format: 'prompt-studio', version: 2, sets, images: {id: dataURL}, dict }
// Settings (API address / key) are never written or read.
import type { PromptSet, Tag } from './types'
import { doc, newSet, lookup, removeSets } from './store'
import { uid, tagsFromPrompt } from './tags'
import { getImage, putImage } from './imagedb'
import { fileToDataUrl } from './image'
import { readPngText, parseGenMeta } from './pngmeta'

export type ImageMode = 'all' | 'cover' | 'none'

interface Bundle { sets: PromptSet[]; images: Record<string, string>; dict: Record<string, string> }

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) }

async function bundle(sets: PromptSet[], mode: ImageMode): Promise<Bundle> {
  const images: Record<string, string> = {}
  const dict: Record<string, string> = {}
  const out = sets.map((s) => {
    const c = clone(s)
    c.shots = mode === 'none' ? [] : mode === 'cover' ? (c.shots || []).slice(0, 1) : c.shots || []
    if (!c.shots.length) delete c.shots
    for (const t of c.tags) { const z = doc.dict[t.en.toLowerCase()]; if (z) dict[t.en.toLowerCase()] = z }
    return c
  })
  for (const s of out) for (const x of s.shots || []) {
    const v = await getImage(x.id).catch(() => undefined)
    if (v) images[x.id] = v
  }
  return { sets: out, images, dict }
}

const stringify = (b: Bundle) => JSON.stringify({ format: 'prompt-studio', version: 2, exportedAt: new Date().toISOString(), ...b })

export function safeName(s: string) { return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'prompt' }

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Export the given sets. split=true writes one file per set. Returns total bytes. */
export async function exportSets(sets: PromptSet[], mode: ImageMode, split: boolean): Promise<number> {
  const day = new Date().toISOString().slice(0, 10)
  let bytes = 0
  if (!split || sets.length === 1) {
    const text = stringify(await bundle(sets, mode))
    bytes = text.length
    download(text, sets.length === 1 ? `${safeName(sets[0].name)}.prompt.json` : `prompts-${sets.length}组-${day}.json`)
    return bytes
  }
  for (const s of sets) {
    const text = stringify(await bundle([s], mode))
    bytes += text.length
    download(text, `${safeName(s.name)}.prompt.json`)
    await new Promise((r) => setTimeout(r, 250)) // browsers drop rapid-fire downloads
  }
  return bytes
}

// ---------------- import ----------------
export interface Candidate {
  set: PromptSet
  images: Record<string, string>
  source: string
  conflict: boolean   // same id already exists (or earlier in this batch)
  pick: boolean
}

function fixSet(raw: any): PromptSet | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tags)) return null
  const base = newSet(String(raw.name || '导入'))
  const tags: Tag[] = raw.tags
    .filter((t: any) => t && typeof t === 'object')
    .map((t: any) => {
      const en = String(t.en || '').trim()
      return {
        id: t.id ? String(t.id) : uid(),
        en,
        zh: typeof t.zh === 'string' && t.zh ? t.zh : lookup(en.toLowerCase()),
        weight: Number(t.weight) || 1,
        section: t.section ? String(t.section) : undefined,
        ...(t.note ? { note: String(t.note) } : {}),
      }
    })
    .filter((t: Tag) => t.en)
  return { ...base, ...raw, tags, negative: String(raw.negative || ''), id: String(raw.id || base.id) }
}

function normalize(data: any): Bundle {
  if (Array.isArray(data)) return { sets: data, images: {}, dict: {} }
  if (data && Array.isArray(data.sets)) return { sets: data.sets, images: data.images || {}, dict: data.dict || {} }
  if (data && Array.isArray(data.tags)) return { sets: [data], images: {}, dict: {} }
  throw new Error('不是千夏绘卷的导出文件')
}

/** Parse dropped/picked files: .json exports, .txt prompts, or images with generation metadata. */
export async function readFiles(files: File[]): Promise<{ list: Candidate[]; dict: Record<string, string>; errors: string[] }> {
  const list: Candidate[] = []
  const dict: Record<string, string> = {}
  const errors: string[] = []
  const seen = new Set(doc.sets.map((s) => s.id))
  const push = (set: PromptSet, images: Record<string, string>, source: string) => {
    const conflict = seen.has(set.id)
    seen.add(set.id)
    list.push({ set, images, source, conflict, pick: true })
  }
  const stem = (f: File) => f.name.replace(/\.[^.]+$/, '')

  for (const f of files) {
    try {
      if (f.type.startsWith('image/')) {
        const meta = parseGenMeta(await readPngText(f).catch(() => ({})))
        if (!meta?.positive) { errors.push(`${f.name}：图片里没有生成参数`); continue }
        const s = newSet(stem(f))
        s.tags = tagsFromPrompt(meta.positive, lookup)
        s.negative = meta.negative
        const id = uid('img')
        s.shots = [{ id, at: Date.now(), meta: meta.raw }]
        push(s, { [id]: await fileToDataUrl(f, 1600, 0.88) }, f.name)
      } else if (/\.txt$/i.test(f.name)) {
        const s = newSet(stem(f))
        s.tags = tagsFromPrompt(await f.text(), lookup)
        push(s, {}, f.name)
      } else {
        const b = normalize(JSON.parse(await f.text()))
        Object.assign(dict, b.dict)
        for (const raw of b.sets) {
          const s = fixSet(raw)
          if (!s) continue
          const imgs: Record<string, string> = {}
          for (const x of s.shots || []) if (b.images[x.id]) imgs[x.id] = b.images[x.id]
          const before = (s.shots || []).length
          s.shots = (s.shots || []).filter((x) => imgs[x.id]) // drop shots whose image wasn't exported
          if (s.shots.length < before) errors.push(`${f.name}：「${s.name}」有 ${before - s.shots.length} 张返图没有随文件导出，已忽略`)
          push(s, imgs, f.name)
        }
      }
    } catch (e: any) {
      errors.push(`${f.name}：${e?.message || e}`)
    }
  }
  return { list, dict, errors }
}

export type ConflictMode = 'copy' | 'overwrite' | 'skip'

/** Add the picked candidates. Images get fresh ids so nothing already stored is clobbered. */
export async function applyImport(list: Candidate[], dict: Record<string, string>, mode: ConflictMode): Promise<{ added: PromptSet[]; skipped: number }> {
  const added: PromptSet[] = []
  let skipped = 0
  for (const c of list) {
    if (!c.pick) continue
    const s = clone(c.set)
    const existing = doc.sets.findIndex((x) => x.id === s.id)
    if (existing >= 0) {
      if (mode === 'skip') { skipped++; continue }
      if (mode === 'copy') { s.id = uid('s'); s.name += '（导入）' }
    }
    const shots = []
    for (const x of s.shots || []) {
      const data = c.images[x.id]
      if (!data) continue
      const nid = uid('img')
      await putImage(nid, data)
      shots.push({ ...x, id: nid })
    }
    s.shots = shots.length ? shots : undefined
    s.updatedAt = Date.now()
    if (existing >= 0 && mode === 'overwrite') {
      const pos = doc.sets.findIndex((x) => x.id === s.id)
      removeSets([s.id]) // also frees its old images
      doc.sets.splice(Math.max(0, pos), 0, s)
    } else {
      doc.sets.unshift(s)
    }
    added.push(s)
  }
  for (const [k, v] of Object.entries(dict)) if (!doc.dict[k]) doc.dict[k] = v
  return { added, skipped }
}
