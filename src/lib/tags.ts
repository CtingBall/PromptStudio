import type { Tag } from './types'

let seq = 0
export function uid(prefix = 't'): string {
  seq += 1
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Parse one tag's weight syntax:
//   tag            -> 1
//   (tag:1.3)      -> 1.3
//   ((tag:1.4))    -> 1.4   (explicit number wins over paren count)
//   ((tag))        -> 1.21  (1.1 per paren)
//   [tag]          -> 0.91
export function parseOne(raw: string): { en: string; weight: number } {
  let s = raw.trim()
  if (!s) return { en: '', weight: 1 }
  let up = 0, down = 0
  while (s.startsWith('(') && s.endsWith(')')) { s = s.slice(1, -1).trim(); up++ }
  while (s.startsWith('[') && s.endsWith(']')) { s = s.slice(1, -1).trim(); down++ }
  if (up > 0) {
    const m = s.match(/^(.*?):\s*([0-9]*\.?[0-9]+)$/)
    if (m) return { en: m[1].trim(), weight: round2(parseFloat(m[2])) }
    return { en: s, weight: round2(Math.pow(1.1, up)) }
  }
  if (down > 0) return { en: s, weight: round2(Math.pow(1 / 1.1, down)) }
  return { en: s, weight: 1 }
}

// Section markers look like 【Pose】.
const SECTION_RE = /【([^】]+)】/

// Parse a full prompt (optionally containing 【Section】 headers) into tags.
export function tagsFromPrompt(text: string, lookup: (en: string) => string): Tag[] {
  const parts = text.split(SECTION_RE) // [before, name1, text1, name2, text2, ...]
  const out: Tag[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const section = i === 0 ? undefined : parts[i - 1].trim()
    for (const raw of parts[i].split(/[,\n]/)) {
      const piece = raw.trim().replace(/\.$/, '').trim()
      if (!piece) continue
      const { en, weight } = parseOne(piece)
      if (!en) continue
      out.push({ id: uid(), en, zh: lookup(en.toLowerCase()) || '', weight, section })
    }
  }
  return out
}

export function serializeTag(t: Tag): string {
  if (t.weight === 1 || !t.weight) return t.en
  return `(${t.en}:${round2(t.weight)})`
}

// Group consecutive tags that share a section.
export function groupTags(tags: Tag[]): Array<{ section?: string; tags: Tag[] }> {
  const groups: Array<{ section?: string; tags: Tag[] }> = []
  for (const t of tags) {
    const last = groups[groups.length - 1]
    if (last && last.section === t.section) last.tags.push(t)
    else groups.push({ section: t.section, tags: [t] })
  }
  return groups
}

// headers=true reproduces the 【Section】 multi-line layout; false gives one flat line.
export function serializeTags(tags: Tag[], headers = true): string {
  const hasSections = tags.some((t) => t.section)
  if (!headers || !hasSections) return tags.map(serializeTag).filter(Boolean).join(', ')
  const lines = groupTags(tags).map((g) => {
    const body = g.tags.map(serializeTag).filter(Boolean).join(', ')
    return g.section ? `【${g.section}】\n${body},` : `${body},`
  })
  return lines.join('\n').replace(/,$/, '')
}

// ---------------------------------------------------------------------------
// Identity filter for character-LoRA prompts: no hair color, eye color or ears.
// Color words in front of hair/eyes are removed (keeping the rest of the tag,
// e.g. "long black hair fluttering" -> "long hair fluttering"). Tags that are
// only a color + body part ("red eyes") or that mention ears are dropped.
// Accessory colors ("black hair ribbon", "black eyepatch") are kept.
// ---------------------------------------------------------------------------
const COLOR =
  '(?:black|white|blonde|blond|brown|brunette|red|crimson|scarlet|blue|azure|navy|green|emerald|' +
  'pink|purple|violet|lavender|silver|grey|gray|platinum|orange|yellow|golden|gold|aqua|cyan|teal|' +
  'amber|dark|light|pale|bright|multicolored|two-tone|gradient|streaked|colored|rainbow)'
const PART = '(?:hair|eyes|eye|pupils|pupil|irises|iris|bangs|sidelocks|ponytail|twintails|braid|braids)'
const ACCESSORY =
  '(?:ribbon|ribbons|bow|bows|ornament|ornaments|clip|clips|band|flower|flowers|tie|ties|pin|pins|' +
  'bobbles|accessory|accessories|scrunchie|patch)'
const COLOR_BEFORE_PART = new RegExp(
  `\\b${COLOR}[\\s-]+(?=(?:[a-z]+\\s+)?${PART}\\b(?!\\s+${ACCESSORY}\\b))`,
  'gi',
)
const COLOR_HAIRED = new RegExp(`\\b${COLOR}-(?:haired|eyed)\\b`, 'gi')
const EARS = /\b(?:ears?|kemonomimi)\b/i
const OTHER_IDENTITY = /\b(?:heterochromia|hair color|eye color)\b/i
const BARE_PART = new RegExp(`^${PART}$`, 'i') // "long red hair" -> "long hair" is kept

export function sanitizeIdentity(en: string): string | null {
  if (EARS.test(en) || OTHER_IDENTITY.test(en)) return null
  let s = en
  for (let i = 0; i < 3; i++) {
    const next = s.replace(COLOR_HAIRED, '').replace(COLOR_BEFORE_PART, '')
    if (next === s) break
    s = next
  }
  s = s.replace(/\s{2,}/g, ' ').trim()
  // Only drop a bare "hair"/"long hair" if we stripped a color from it;
  // an original "long hair" is a hairstyle and stays.
  if (!s || (s !== en.trim() && BARE_PART.test(s))) return null
  return s
}
