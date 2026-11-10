// Layout spec shared by every AI action that writes bbox layouts
// (one-click auto layout, layout mode, AI edit / variants / review).
// Tuned for MOSS-Image + ComfyUI CreateBoundingBoxes → MOSSImageLayoutPrompt.
import type { Char, Region } from './types'

export const uidR = () => 'r' + Math.random().toString(36).slice(2, 9)

// One character per line: "名字=触发词 | 引导词 | 默认服装" (also accepts ":" / "：" / tab); all but the name optional.
export function parseChars(raw: string): Char[] {
  const out: Char[] = []
  for (const line of (raw || '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const [head, ...rest] = t.split(/\s*[|｜]\s*/)
    const m = head.split(/\s*[=:：\t]\s*/)
    const name = (m[0] || '').trim()
    if (!name) continue
    out.push({
      id: String.fromCharCode(65 + out.length), name,
      trigger: (m[1] || '').trim() || undefined,
      guide: (rest[0] || '').trim() || undefined,
      outfit: rest.slice(1).join(', ').trim() || undefined,
    })
    if (out.length >= 8) break
  }
  return out
}

export function charsText(chars: Char[]): string {
  if (!chars.length) return ''
  return `画面角色（用 cid 区分）：\n` + chars.map((c) =>
    `- ${c.id}：${c.name}${c.trigger ? `（触发词 ${c.trigger}）` : ''}${c.guide ? `，固定特征：${c.guide}` : ''}${c.outfit ? `，默认服装：${c.outfit}` : '，未设服装'}`).join('\n') +
    `\n角色框的触发词和固定特征由程序自动加在开头，你在 desc 里不要写触发词、名字和固定特征，也不要补发色、瞳色等外貌；只写这个框里角色在做什么。触发词不要写进 sections。\n服装：默认服装也由程序自动加；只有主题要求换装（或这个角色没设服装、需要指定）时，才在该角色框的 outfit 字段写新服装（英文短语），否则 outfit 留空，desc 里也不写衣服。`
}

export const LAYOUT_SPEC = `【画框布局规范】（MOSS-Image 布局：每个框的 desc 就是这个区域的提示词，用自然的英文短句）
1. 每个框只描述框里有什么。漫画/多格时，一格就是一个 obj 框，desc 写成 "Top-left panel: …" 再描述这一格里的画面；分镜、特写靠框的大小和描述自然体现。
2. kind：
   - "char" 角色框：cid 写角色 id。desc 只写动作、姿势、表情、朝向/视线（看向谁）、手里的东西；服装不写进 desc，要换装就写在 outfit 字段。15–40 个英文词。提到别的角色时用位置称呼（如 "the girl on the right"），不要写 Character B。
   - "obj" 物件或分镜格：描述里面的内容。
   - "text" 文字框：text 是画出来的原文（对话 ≤12 字），speaker 写说话角色的 cid（旁白、招牌留空），desc 写气泡或字体样式和位置，如 "white speech bubble near the girl's head"。
3. 画面的总体风格、场景、光照写进 sections，不要单独画背景框。
4. 坐标：画布比例 0–1，(0,0) 左上角，x/y 是框左上角，w/h 是宽高。主体要撑满画面。
5. 顺序：先 obj 和 char，text 放最后。`

export const LAYOUT_SCHEMA = `"layout": [{"n": 1, "kind": "char|obj|text", "cid": "A", "outfit": "只有换装时才写", "speaker": "A", "x": 0, "y": 0, "w": 0, "h": 0, "desc": "...", "text": "只有文字框才有"}]`

// Existing boxes, for edit/review/layout-mode prompts.
export function layoutText(regions: Region[], canvas: { w: number; h: number }): string {
  const f = (n: number) => n.toFixed(2)
  const lines = regions.map((r, i) => {
    const k = r.kind || 'obj'
    const extra = k === 'char' ? ` cid=${r.cid || '?'}${r.outfit ? ` outfit=${r.outfit}` : ''}` : k === 'text' ? ` speaker=${r.speaker || '无'} 文字「${r.text}」` : ''
    const d = k === 'text' ? r.desc || '' : r.text
    return `n=${i + 1} kind=${k}${extra} x=${f(r.x)} y=${f(r.y)} w=${f(r.w)} h=${f(r.h)}：${d || '（未写）'}`
  })
  return `画布 ${canvas.w}×${canvas.h}。现有画框：\n${lines.join('\n') || '（无）'}`
}

export interface LayoutBox {
  n?: number; kind: 'obj' | 'char' | 'text'; cid?: string; outfit?: string; speaker?: string
  x: number; y: number; w: number; h: number; desc: string; text?: string
}

export function parseLayout(list: unknown): LayoutBox[] {
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }
  const str = (v: unknown, max = 600) => String(v ?? '').trim().slice(0, max)
  const arr = Array.isArray(list) ? list : []
  return arr.map((b: any) => {
    let x = num(b?.x), y = num(b?.y), w = num(b?.w), h = num(b?.h)
    const m = Math.max(x, y, w, h)
    const k = m > 100 ? 1000 : m > 1.5 ? 100 : 1 // tolerate 0–1000 / 0–100
    x /= k; y /= k; w /= k; h /= k
    x = Math.min(1, Math.max(0, x)); y = Math.min(1, Math.max(0, y))
    w = Math.min(1 - x, Math.max(0, w)); h = Math.min(1 - y, Math.max(0, h))
    const kind = ['char', 'text'].includes(b?.kind) ? b.kind : 'obj'
    // legacy {tags:[]} replies
    const desc = str(b?.desc) || (Array.isArray(b?.tags) ? b.tags.map(String).join(', ') : '')
    const n = num(b?.n)
    return {
      n: Number.isFinite(n) ? n : undefined, kind, x, y, w, h, desc,
      cid: kind === 'char' ? str(b?.cid, 4).toUpperCase() || undefined : undefined,
      outfit: kind === 'char' ? str(b?.outfit, 300) || undefined : undefined,
      speaker: kind === 'text' ? str(b?.speaker, 4).toUpperCase() || undefined : undefined,
      text: kind === 'text' ? str(b?.text, 200) : undefined,
    } as LayoutBox
  }).filter((b) => Number.isFinite(b.x) && b.w >= 0.02 && b.h >= 0.02 && (b.kind !== 'text' || b.text)
      && !(b.kind === 'obj' && b.w * b.h > 0.8)) // background boxes belong in tags
    .slice(0, 40)
}

const ctr = (r: Region) => [r.x + r.w / 2, r.y + r.h / 2]
// the speaker's char box closest to a text box
export function speakerBox(t: Region, all: Region[]): Region | undefined {
  const c = ctr(t)
  const d = (r: Region) => { const q = ctr(r); return Math.hypot(q[0] - c[0], q[1] - c[1]) }
  return all.filter((x) => x.kind === 'char' && x.cid === t.speaker).sort((a, b) => d(a) - d(b))[0]
}

// Problems worth a warning before export
export function checkLayout(all: Region[]): string[] {
  const out: string[] = []
  all.forEach((t, i) => {
    if (t.kind === 'text' && t.speaker && !speakerBox(t, all)) out.push(`#${i + 1}「${t.text}」的说话人 ${t.speaker} 没有角色框`)
  })
  return out
}

// Boxes → regions. keep=true keeps coords of existing regions matched by n (layout mode).
export function boxesToRegions(boxes: LayoutBox[], grid = 0, old?: Region[]): Region[] {
  const sn = (v: number) => (grid ? Math.round(v * grid) / grid : v)
  const min = grid ? 1 / grid : 0.04
  const regs: Region[] = boxes.map((b) => {
    const prev = old && b.n ? old[b.n - 1] : undefined
    let { x, y, w, h } = prev || b
    if (!prev) {
      x = sn(x); y = sn(y)
      w = Math.max(min, Math.min(1 - x, sn(w))); h = Math.max(min, Math.min(1 - y, sn(h)))
    }
    const r: Region = { id: prev?.id || uidR(), x, y, w, h, kind: b.kind === 'obj' ? undefined : b.kind, text: '' }
    if (b.kind === 'text') { r.text = b.text || ''; r.desc = b.desc; r.speaker = b.speaker }
    else { r.text = b.desc; if (b.kind === 'char') { r.cid = b.cid; r.outfit = b.outfit || prev?.outfit } }
    return r
  })
  // order: chars/objs first, text boxes last (foreground)
  const rank = (r: Region) => (r.kind === 'text' ? 1 : 0)
  return regs.map((r, i) => [r, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r)
}

// Final caption for a char box: trigger + fixed guide + outfit (box override, else default) + action (legacy "Character A, trigger," prefix stripped).
export function charBoxDesc(r: Region, chars?: Char[]): string {
  const c = chars?.find((x) => x.id === r.cid)
  let act = (r.text || '').trim().replace(/^Character [A-Z]\b[,:]?\s*/i, '')
  if (c?.trigger && act.toLowerCase().startsWith(c.trigger.toLowerCase())) act = act.slice(c.trigger.length).replace(/^[,\s]+/, '')
  const outfit = (r.outfit || '').trim() || c?.outfit
  return [c?.trigger, c?.guide, outfit ? (/^(wearing|dressed|in )/i.test(outfit) ? outfit : 'wearing ' + outfit) : '', act].filter(Boolean).join(', ')
}

// Final caption for a text box: style + who says it.
export function textBoxDesc(r: Region, all: Region[], chars?: Char[]): string {
  const base = (r.desc || '').trim() || 'speech bubble'
  if (!r.speaker || /spoken by/i.test(base)) return base
  const c = chars?.find((x) => x.id === r.speaker)
  const sp = speakerBox(r, all)
  const who = sp ? `the character in box ${all.indexOf(sp) + 1}` : `Character ${r.speaker}`
  return `${base}, spoken by ${who}${c?.trigger ? ` (${c.trigger})` : ''}`
}
