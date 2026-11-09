import { reactive, watch, computed } from 'vue'
import type { StudioDoc, PromptSet, Tag, Settings } from './types'
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
watch(
  doc,
  () => {
    clearTimeout(t)
    t = window.setTimeout(() => {
      localStorage.setItem(LS_KEY, JSON.stringify(doc))
    }, 300)
  },
  { deep: true },
)

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
