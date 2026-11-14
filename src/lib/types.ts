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
  kind?: 'obj' | 'char' | 'text'   // MOSS layout: object (default; also comic panels) / character / text
  cid?: string    // char box: character id (A/B/…)
  speaker?: string // text box: id of the character who says it
  desc?: string   // text box: bubble/style description (text holds the words)
  outfit?: string // char box: outfit for this box only (overrides the character's default)
}

// A character in the picture; trigger = LoRA trigger word (optional).
export interface Char { id: string; name: string; trigger?: string; guide?: string; outfit?: string }  // guide = fixed prompt, outfit = default clothes (replaceable per box)

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
  history?: SetVersion[]                // newest first, capped
  tags: Tag[]
  negative: string
  createdAt: number
  updatedAt: number
}

export interface StudioDoc {
  version: 1
  sets: PromptSet[]
  dict: Record<string, string>   // en(lowercased) -> zh cache
  folders?: string[]             // explicitly created folders (may be empty), paths like "角色/hanabi"
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
  genChars: string       // characters, one per line: 名字=触发词 | 引导词
  firstLine: string      // put on line 1 of the MOSS prompt, e.g. <|artist|>fkey<|/artist|>
  genFormat: PromptFormat // how generated prompts are written
  routes: Partial<Record<AiTask, AiRoute>> // per-feature model override; empty fields fall back to the main AI
}

export type PromptFormat = 'tags' | 'natural' | 'mixed' | 'gbc'
export const FORMAT_LABEL: Record<PromptFormat, string> = { tags: '标签', natural: '自然语言', mixed: '标签+自然语言', gbc: 'GBC 图结构' }

export type AiTask = 'translate' | 'generate' | 'edit' | 'classify' | 'review'
export interface AiRoute { baseUrl?: string; apiKey?: string; model?: string }
export const AI_TASKS: Array<{ id: AiTask; label: string; hint: string }> = [
  { id: 'translate', label: '翻译', hint: '标签中英互译，便宜快速的模型就够' },
  { id: 'generate', label: '一键生成 / 反推', hint: '写提示词，用最强的；带参考图时要能看图' },
  { id: 'edit', label: 'AI 修改 / 变体', hint: '按要求改写已有提示词' },
  { id: 'classify', label: '自动整理', hint: '分级、文件夹、标签、起名' },
  { id: 'review', label: '诊断 / 返图检查', hint: '返图检查需要能看图的模型' },
]

/** a saved earlier state of a set, for history / rollback */
export interface SetVersion { at: number; label: string; name: string; tags: Tag[]; negative: string; regions?: Region[] }

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
  firstLine: '',
  genFormat: 'tags',
  routes: {},
}

// Section order used for generation (matches the user's template).
export const GEN_SECTIONS = [
  'Subject & Shot',
  'Character',
  'Expression',
  'Pose & Action',
  'Outfit',
  'Scene',
  'Lighting & Color',
  'Style & FX',
] as const
