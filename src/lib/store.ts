import { reactive, watch, computed } from 'vue'
import type { StudioDoc, PromptSet, Tag, Settings, SetVersion } from './types'
import { DEFAULT_SETTINGS } from './types'
import { uid, tagsFromPrompt, serializeTags, parseOne } from './tags'
import { deleteImage } from './imagedb'

const LS_KEY = 'prompt-studio-doc-v1'

function emptyDoc(): StudioDoc {
  return { version: 1, sets: [], dict: {}, settings: { ...DEFAULT_SETTINGS } }
}

export const SCHEMA = 1

function load(): StudioDoc {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return emptyDoc()
    const d = JSON.parse(raw) as StudioDoc
    // Never discard user data on a version mismatch. Keep a raw snapshot of the
    // old payload so nothing is lost, then forward-fill missing fields. Future
    // schema bumps migrate here instead of wiping.
    if (d.version !== SCHEMA) {
      try { localStorage.setItem(LS_KEY + '.bak.v' + d.version, raw) } catch {}
      d.version = SCHEMA
    }
    d.dict ||= {}
    d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) }
    d.sets ||= []
    return d
  } catch (e) {
    // Parse failure: stash the unparseable payload instead of silently dropping it.
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) localStorage.setItem(LS_KEY + '.corrupt.' + Date.now(), raw)
    } catch {}
    return emptyDoc()
  }
}

export const doc = reactive<StudioDoc>(load())

// Seed an example set only AFTER `doc` exists, so newSet()/lookup() never touch
// `doc` during its own initialization (which would throw a TDZ ReferenceError).
if (!doc.sets.length) {
  doc.sets.push(newSet('示例', '1girl, solo, long hair, looking at viewer'))
}

let t: number | undefined
let dirty = false
let warned = false
function save(): void {
  clearTimeout(t)
  t = undefined
  if (!dirty) return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(doc))
    dirty = false
    warned = false
  } catch (e: any) {
    if (!warned) {
      warned = true
      const quota = e?.name === 'QuotaExceededError' || e?.code === 22
      window.dispatchEvent(new CustomEvent('ps:toast', {
        detail: (quota ? '保存失败：浏览器存储空间已满' : '保存失败：' + (e?.message || e)) + '，请尽快导出备份',
      }))
    }
  }
}
watch(
  doc,
  () => {
    dirty = true
    clearTimeout(t)
    t = window.setTimeout(save, 300)
  },
  { deep: true },
)
window.addEventListener('pagehide', save)
window.addEventListener('beforeunload', save)

// ---- dictionary cache ----
export function lookup(enLower: string): string {
  return doc.dict[enLower] || ''
}
export function remember(en: string, zh: string): void {
  if (en && zh) doc.dict[en.toLowerCase()] = zh
}

// ---- set operations ----
export function newSet(name = '未命名', prompt = ''): PromptSet {
  const now = Date.now()
  return {
    id: uid('s'),
    name,
    tags: tagsFromPrompt(prompt, lookup),
    negative: '',
    createdAt: now,
    updatedAt: now,
  }
}

export function addSet(name?: string): PromptSet {
  const s = newSet(name)
  doc.sets.unshift(s)
  return s
}

export function removeSet(id: string): void {
  removeSets([id])
}

// Delete sets and any result images no remaining set still references.
export function removeSets(ids: string[]): void {
  const gone = doc.sets.filter((s) => ids.includes(s.id))
  doc.sets = doc.sets.filter((s) => !ids.includes(s.id))
  const used = new Set(doc.sets.flatMap((s) => (s.shots || []).map((x) => x.id)))
  for (const s of gone) for (const x of s.shots || []) if (!used.has(x.id)) deleteImage(x.id).catch(() => {})
}

export const folders = computed(() => [...new Set(doc.sets.map((s) => s.folder).filter(Boolean))].sort() as string[])
export const allLabels = computed(() => [...new Set(doc.sets.flatMap((s) => s.labels || []))].sort())

// Build tags: quality prefix (no section) + sectioned tags, deduped.
export function buildTags(prefix: string, sections: Array<{ name: string; tags: string[] }>): Tag[] {
  const tags: Tag[] = []
  const seen = new Set<string>()
  const push = (raw: string, section?: string) => {
    const piece = raw.trim().replace(/[,.]+$/, '').trim()
    if (!piece) return
    const { en, weight } = parseOne(piece)
    if (!en || seen.has(en.toLowerCase())) return
    seen.add(en.toLowerCase())
    tags.push({ id: uid(), en, zh: lookup(en.toLowerCase()), weight, section })
  }
  for (const p of prefix.split(',')) push(p)
  for (const sec of sections) for (const t of sec.tags) push(t, sec.name)
  return tags
}

export function dedupe(list: string[]): string[] {
  return Array.from(new Map(list.map((t) => t.trim()).filter(Boolean).map((t) => [t.toLowerCase(), t])).values())
}

export function duplicateSet(id: string): PromptSet | undefined {
  const src = doc.sets.find((s) => s.id === id)
  if (!src) return
  const copy = JSON.parse(JSON.stringify(src)) as PromptSet
  copy.id = uid('s')
  copy.name = src.name + ' 副本'
  copy.tags.forEach((t) => (t.id = uid()))
  copy.createdAt = copy.updatedAt = Date.now()
  doc.sets.unshift(copy)
  return copy
}

export function touch(set: PromptSet): void {
  set.updatedAt = Date.now()
}

export function promptText(set: PromptSet, headers = true): string {
  return serializeTags(set.tags, headers)
}

export function settings(): Settings {
  return doc.settings
}

// ---- import / export ----
// withImages embeds result images (as data URLs) so a backup is complete.
export function addTag(set: PromptSet, en: string): Tag {
  const tag: Tag = { id: uid(), en: en.trim(), zh: lookup(en.trim().toLowerCase()), weight: 1 }
  set.tags.push(tag)
  touch(set)
  return tag
}

export function removeTag(set: PromptSet, id: string): void {
  const i = set.tags.findIndex((t) => t.id === id)
  if (i >= 0) set.tags.splice(i, 1)
  touch(set)
}

// ---- version history: saved before every AI rewrite / bulk change ----
const HISTORY_MAX = 15
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
export function snapshot(set: PromptSet, label: string): void {
  const v: SetVersion = { at: Date.now(), label, name: set.name, tags: clone(set.tags), negative: set.negative,
    regions: set.regions?.length ? clone(set.regions) : undefined }
  const h = set.history || []
  const last = h[0]
  // skip if nothing changed since the last saved version
  if (last && JSON.stringify(last.tags) === JSON.stringify(v.tags) && last.negative === v.negative) return
  set.history = [v, ...h].slice(0, HISTORY_MAX)
}
export function restoreVersion(set: PromptSet, v: SetVersion): void {
  snapshot(set, '回退前')
  set.name = v.name
  set.tags = clone(v.tags)
  set.negative = v.negative
  if (v.regions) set.regions = clone(v.regions)
  touch(set)
}
