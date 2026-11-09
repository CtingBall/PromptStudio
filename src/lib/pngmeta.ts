// Read generation parameters embedded in PNG text chunks (A1111/Forge "parameters",
// ComfyUI "prompt" JSON, NovelAI "Description"/"Comment").
export async function readPngText(file: File): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const buf = new Uint8Array(await file.arrayBuffer())
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (buf.length < 8 || sig.some((b, i) => buf[i] !== b)) return out
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
