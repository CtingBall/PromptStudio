// Read generation parameters embedded in PNG text chunks (A1111/Forge "parameters",
// ComfyUI "prompt" JSON, NovelAI "Description"/"Comment").
// JPEG / WebP: WebUI and Civitai put the same "parameters" text into EXIF UserComment.
export function exifUserComment(buf: Uint8Array): string {
  let tiff = -1
  if (buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: walk segments to APP1 "Exif\0\0"
    let p = 2
    while (p + 4 < buf.length && buf[p] === 0xff) {
      const m = buf[p + 1], len = (buf[p + 2] << 8) | buf[p + 3]
      if (m === 0xe1 && buf[p + 4] === 0x45 && buf[p + 5] === 0x78 && buf[p + 6] === 0x69 && buf[p + 7] === 0x66) { tiff = p + 10; break }
      if (m === 0xda) break
      p += 2 + len
    }
  } else if (String.fromCharCode(...buf.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...buf.subarray(8, 12)) === 'WEBP') {
    let p = 12
    while (p + 8 <= buf.length) {
      const id = String.fromCharCode(...buf.subarray(p, p + 4))
      const len = buf[p + 4] | (buf[p + 5] << 8) | (buf[p + 6] << 16) | (buf[p + 7] << 24)
      if (id === 'EXIF') { tiff = p + 8; if (String.fromCharCode(...buf.subarray(tiff, tiff + 4)) === 'Exif') tiff += 6; break }
      p += 8 + len + (len & 1)
    }
  }
  if (tiff < 0 || tiff + 8 > buf.length) return ''
  const le = buf[tiff] === 0x49
  const u16 = (o: number) => le ? buf[tiff + o] | (buf[tiff + o + 1] << 8) : (buf[tiff + o] << 8) | buf[tiff + o + 1]
  const u32 = (o: number) => le ? (u16(o) | (u16(o + 2) << 16)) >>> 0 : ((u16(o) << 16) | u16(o + 2)) >>> 0
  const find = (ifd: number, tag: number): [number, number] | null => {
    if (ifd + 2 > buf.length - tiff) return null
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      if (u16(e) === tag) return [u32(e + 4), u32(e + 8)] // count, value/offset
    }
    return null
  }
  const exif = find(u32(4), 0x8769)
  if (!exif) return ''
  const uc = find(exif[1], 0x9286)
  if (!uc || uc[0] <= 8) return ''
  const start = tiff + uc[1], data = buf.subarray(start + 8, start + uc[0])
  const head = String.fromCharCode(...buf.subarray(start, start + 7))
  if (head.startsWith('UNICODE')) {
    // piexif writes UTF-16BE; some tools write LE — pick the one with fewer zero high bytes in front
    const be = data[0] === 0 && data[1] !== 0
    return new TextDecoder(be ? 'utf-16be' : 'utf-16le').decode(data).replace(/\0+$/, '')
  }
  return new TextDecoder('utf-8').decode(data).replace(/\0+$/, '')
}

export async function readPngText(file: File): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const buf = new Uint8Array(await file.arrayBuffer())
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (buf.length < 8 || sig.some((b, i) => buf[i] !== b)) {
    const c = exifUserComment(buf).trim()
    if (c) out[c.startsWith('{') ? 'prompt' : 'parameters'] = c
    return out
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const dec = new TextDecoder('utf-8')
  const latin = new TextDecoder('latin1')
  let p = 8
  while (p + 8 <= buf.length) {
    const len = dv.getUint32(p)
    const type = latin.decode(buf.subarray(p + 4, p + 8))
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'tEXt') {
      const z = data.indexOf(0)
      if (z > 0) out[latin.decode(data.subarray(0, z))] = dec.decode(data.subarray(z + 1))
    } else if (type === 'iTXt') {
      const z = data.indexOf(0)
      if (z > 0 && data[z + 1] === 0) { // uncompressed only
        const z2 = data.indexOf(0, z + 3)
        const z3 = z2 >= 0 ? data.indexOf(0, z2 + 1) : -1
        if (z3 >= 0) out[latin.decode(data.subarray(0, z))] = dec.decode(data.subarray(z3 + 1))
      }
    } else if (type === 'IEND') break
    p += 12 + len
  }
  return out
}

export interface GenMeta { positive: string; negative: string; params: string; raw: string }

export function parseGenMeta(t: Record<string, string>): GenMeta | null {
  const a = t.parameters
  if (a) {
    const ni = a.indexOf('\nNegative prompt:')
    const si = a.search(/\n?Steps: \d/)
    const posEnd = ni >= 0 ? ni : si >= 0 ? si : a.length
    return {
      positive: a.slice(0, posEnd).trim(),
      negative: ni >= 0 ? a.slice(ni + 17, si > ni ? si : a.length).trim() : '',
      params: si >= 0 ? a.slice(si).trim() : '',
      raw: a,
    }
  }
  if (t.prompt) {
    try {
      const g = JSON.parse(t.prompt) as Record<string, any>
      const texts = Object.values(g)
        .filter((n) => /CLIPTextEncode/i.test(n?.class_type || '') && typeof n?.inputs?.text === 'string')
        .map((n) => n.inputs.text as string)
      if (texts.length) return { positive: texts[0], negative: texts[1] || '', params: 'ComfyUI', raw: t.prompt }
    } catch { /* not JSON */ }
  }
  if (t.Description) return { positive: t.Description, negative: '', params: t.Comment || '', raw: t.Description }
  return null
}

// shot.meta stores the raw text: ComfyUI "prompt" JSON or an A1111/NovelAI string.
export function metaOf(raw: string): GenMeta | null {
  const s = raw.trim()
  if (s.startsWith('{')) {
    try { JSON.parse(s); return parseGenMeta({ prompt: s }) } catch { /* not JSON, fall through */ }
  }
  return parseGenMeta({ parameters: raw })
}

// ---- structured generation info: model / LoRAs / sampler / steps / CFG / seed / size ----
export interface LoraUse { name: string; weight?: number }
export interface GenInfo {
  source: 'A1111' | 'ComfyUI' | ''
  model?: string
  vae?: string
  loras: LoraUse[]
  sampler?: string
  scheduler?: string
  steps?: number
  cfg?: number
  seed?: string
  size?: string
  denoise?: number
}

// "models/foo/bar.safetensors" → "bar"
export function shortName(p: string): string {
  return String(p).split(/[\\/]/).pop()!.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, '')
}
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(+v) ? +v : undefined)
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined)

// A1111 "Steps: 28, Sampler: Euler a, Lora hashes: "a: 1, b: 2", Model: x" → map
export function a1111Params(p: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /\s*([A-Za-z][\w \-/]*?):\s*("(?:\\.|[^"\\])*"|[^,]*)(?:,|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(p)) && m[0]) {
    let v = m[2].trim()
    if (v.startsWith('"')) { try { v = JSON.parse(v) } catch { v = v.slice(1, -1) } }
    out[m[1].trim()] = v
  }
  return out
}

function fromA1111(meta: GenMeta): GenInfo {
  const p = a1111Params(meta.params)
  const loras: LoraUse[] = []
  for (const m of meta.positive.matchAll(/<(?:lora|lyco):([^:>]+)(?::([-\d.]+))?[^>]*>/gi))
    loras.push({ name: shortName(m[1]), weight: m[2] ? +m[2] : undefined })
  for (const part of (p['Lora hashes'] || '').split(',')) {
    const n = part.split(':')[0].trim()
    if (n && !loras.some((l) => l.name === n)) loras.push({ name: n })
  }
  return {
    source: 'A1111', loras,
    model: p.Model ? shortName(p.Model) : p['Model hash'] ? '#' + p['Model hash'] : undefined,
    vae: p.VAE ? shortName(p.VAE) : undefined,
    sampler: p.Sampler, scheduler: p['Schedule type'],
    steps: num(p.Steps), cfg: num(p['CFG scale']), seed: p.Seed, size: p.Size,
    denoise: num(p['Denoising strength']),
  }
}

function fromComfy(g: Record<string, any>): GenInfo {
  const info: GenInfo = { source: 'ComfyUI', loras: [] }
  for (const n of Object.values(g)) {
    const t = String(n?.class_type || ''), i = n?.inputs || {}
    if (!info.model && /checkpoint|unet|diffusion|model.*loader/i.test(t) && !/lora|clip|vae|upscale/i.test(t)) {
      const m = str(i.ckpt_name) || str(i.unet_name) || str(i.model_name)
      if (m) info.model = shortName(m)
    }
    if (/vaeloader/i.test(t) && str(i.vae_name)) info.vae = shortName(i.vae_name)
    if (/lora/i.test(t)) {
      if (str(i.lora_name)) info.loras.push({ name: shortName(i.lora_name), weight: num(i.strength_model) })
      // rgthree Power Lora Loader & friends: lora_1: {on, lora, strength}
      for (const v of Object.values(i)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && str((v as any).lora) && (v as any).on !== false)
          info.loras.push({ name: shortName((v as any).lora), weight: num((v as any).strength) })
      }
    }
    if (/sampler/i.test(t) && !/select|custom/i.test(t)) {
      info.seed ??= str(i.seed) ?? str(i.noise_seed)
      info.steps ??= num(i.steps)
      info.cfg ??= num(i.cfg)
      info.sampler ??= str(i.sampler_name)
      info.scheduler ??= str(i.scheduler)
      info.denoise ??= num(i.denoise)
    }
    if (!info.size && /latent/i.test(t) && num(i.width) && num(i.height)) info.size = `${i.width}x${i.height}`
  }
  return info
}

const infoCache = new Map<string, GenInfo | null>()
export function genInfo(raw: string | undefined): GenInfo | null {
  if (!raw) return null
  if (infoCache.has(raw)) return infoCache.get(raw)!
  let r: GenInfo | null = null
  const s = raw.trim()
  if (s.startsWith('{')) {
    try { r = fromComfy(JSON.parse(s)) } catch { /* not JSON */ }
  }
  if (!r) { const m = metaOf(raw); r = m && m.params ? fromA1111(m) : null }
  if (r && !r.model && !r.loras.length && !r.steps && !r.seed) r = null
  if (infoCache.size > 500) infoCache.clear()
  infoCache.set(raw, r)
  return r
}

// one-line summary, e.g. "animagine · 28步 · CFG 5 · Euler a · 832x1216 · seed 123"
export function infoLine(i: GenInfo): string {
  return [i.model, i.steps && i.steps + '步', i.cfg != null && 'CFG ' + i.cfg, i.sampler && i.sampler + (i.scheduler ? ' / ' + i.scheduler : ''),
    i.size, i.seed && 'seed ' + i.seed, i.denoise != null && i.denoise < 1 && '重绘 ' + i.denoise].filter(Boolean).join(' · ')
}
