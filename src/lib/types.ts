// A single prompt token: the English text, its Chinese gloss, and optional weight.
export interface Tag {
  id: string
  en: string        // the tag/word as it appears in the prompt, e.g. "1girl"
  zh: string        // Chinese translation; '' until resolved
  weight: number    // emphasis weight; 1 = none. (tag:1.2) style
  section?: string  // optional group header, e.g. "Pose" -> 【Pose】
  note?: string
}

// Rating: SAFE = 全年龄, SFW = 16+, NSFW = 18+
export type Category = 'SAFE' | 'SFW' | 'NSFW'
export const CATEGORIES: Category[] = ['SAFE', 'SFW', 'NSFW']
export const RATING_LABEL: Record<Category, string> = { SAFE: '全年龄', SFW: '16+', NSFW: '18+' }

// A result image ("返图") attached to a prompt set; bytes live in IndexedDB.
export interface Shot {
  id: string
  meta?: string   // generation parameters read from the PNG, if any
  note?: string
  at: number
}

// One box on the layout canvas. x/y/w/h are fractions of the canvas (0–1).
export interface Region {
  id: string
  x: number
  y: number
  w: number
  h: number
  text: string   // what is inside the box (user description or generated tags)
  kind?: 'obj' | 'char' | 'text'   // ComfyUI MOSS layout label: object (default) / character / rendered text
  cid?: string    // char box: character id (A/B/…)
  speaker?: string // text box: id of the character who says it
  desc?: string   // text box: bubble/style description (text holds the words)
}

// A character in the picture; trigger = LoRA trigger word (optional).
export interface Char { id: string; name: string; trigger?: string }

export interface PromptSet {
  id: string
  name: string
  category?: Category
  folder?: string                       // one folder, e.g. "角色/hanabi"
  labels?: string[]                     // free labels, e.g. 夜景, 泳装
  favorite?: boolean
  shots?: Shot[]                        // result images; shots[0] is the cover
  regions?: Region[]                    // bbox / grid regions, coords normalized 0–1
  canvas?: { w: number; h: number }     // target image size for the regions
  chars?: Char[]                        // characters (A/B/…) used by layout boxes
  tags: Tag[]
  negative: string
  createdAt: number
  updatedAt: number
}

export interface StudioDoc {
  version: 1
  sets: PromptSet[]
  dict: Record<string, string>   // en(lowercased) -> zh cache
  settings: Settings
}

export interface Settings {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  autoTranslate: boolean
  // ---- one-click generation injection ----
  genPrefix: string      // quality tags always prepended
  genNegative: string    // default negative prompt for generated sets
  genRules: string       // extra user rules appended to the system prompt
  banIdentity: boolean   // strip hair color / eye color / ears (for character LoRAs)
  maxImages: number      // reference images per request (xAI vision accepts several)
  bboxScale: 1 | 1000    // bbox output coordinate scale: 0–1 floats or 0–1000 ints
  genChars: string       // character LoRAs, one per line: 名字=触发词
}

export const DEFAULT_GEN_PREFIX =
  'masterpiece, best quality, ultra-detailed, highres, illustration, layered composition, detailed composition'

export const DEFAULT_GEN_NEGATIVE =
  'worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers, deformed, blurry, jpeg artifacts, watermark, signature, text'

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://api.x.ai/v1',
  apiKey: '',
  model: 'grok-4-fast',
  temperature: 0.3,
  autoTranslate: true,
  genPrefix: DEFAULT_GEN_PREFIX,
  genNegative: DEFAULT_GEN_NEGATIVE,
  genRules: '',
  banIdentity: true,
  maxImages: 4,
  bboxScale: 1000,
  genChars: '',
}

// Section order used for generation (matches the user's template).
export const GEN_SECTIONS = [
  'Common',
  'Appearance',
  'Expression',
  'Pose',
  'Outfit',
  'Atmosphere & Dynamic FX',
  'Background & Lighting',
] as const
