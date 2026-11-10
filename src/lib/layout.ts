// Layout spec shared by every AI action that writes bbox layouts
// (one-click auto layout, layout mode, AI edit / variants / review).
// Tuned for MOSS-Image + ComfyUI CreateBoundingBoxes → MOSSImageLayoutPrompt.
import type { Char, Region } from './types'

export const uidR = () => 'r' + Math.random().toString(36).slice(2, 9)

// "名字=触发词" per line (also accepts ":" / "：" / tab); trigger optional.
export function parseChars(raw: string): Char[] {
  const out: Char[] = []
  for (const line of (raw || '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const m = t.split(/\s*[=:：\t]\s*/)
    const name = (m[0] || '').trim()
    if (!name) continue
    out.push({ id: String.fromCharCode(65 + out.length), name, trigger: (m[1] || '').trim() || undefined })
    if (out.length >= 8) break
  }
  return out
}

export function charsText(chars: Char[]): string {
  if (!chars.length) return ''
  return `画面角色（用 id 区分；有触发词的是角色 LoRA）：\n` + chars.map((c) =>
    `- ${c.id}：${c.name}${c.trigger ? `，LoRA 触发词「${c.trigger}」` : '，无 LoRA'}`).join('\n') +
    `\n触发词原样放进 Common 分段；有 LoRA 的角色不写先天外貌（发色、瞳色、耳朵、尾巴、体型），只写服装、姿势、动作、表情。`
}

export const LAYOUT_SPEC = `【画框布局规范】（ComfyUI MOSS-Image 官方画框节点，每个框会被单独编码，框的描述就是这个区域的提示词）
1. 框的类型 kind：
   - "char" 角色：每个人物一个框，框住整个人（从头到脚可见部分）。必须给 cid（A、B、C…）。
   - "obj" 物件：只给重要的道具、动物、载具、建筑主体。
   - "text" 文字：每一句对话 / 招牌 / 标题一个框。
2. 背景不画框：天空、地面、房间、远景、光照、氛围全部写进 sections（Background & Lighting 等），不要做成框。
3. 角色框 desc（英文自然语言，25–60 词）：开头写 "Character A, " 这样的 id；有 LoRA 触发词时紧接着写触发词。再写：服装、姿势、动作、表情、朝向/视线（朝向谁）、手里的东西、在画面中的位置。
   - 多个角色必须靠服装、姿势、动作、位置明显区分，绝不混写到一个框里，也不要重复同一套描述。
   - 有 LoRA 的角色：不写发色、瞳色、耳朵、尾巴、体型等先天外貌（LoRA 负责），只写服装、姿势、动作、表情。
   - 没有 LoRA 的角色：可以写外貌特征。
4. 文字框：
   - text = 实际要画出来的文字（保持原语言，对话尽量短，≤12 字或 ≤6 个英文单词）。
   - speaker = 说话角色的 cid（招牌/标题留空）。
   - desc（英文）= 气泡/字体样式 + 归属，例如 "white rounded speech bubble, bold black handwritten font, the tail points down-left to Character A's mouth"。
   - 位置：对话框放在说话者头部的上方或侧上方，水平方向靠近说话者，不要盖住任何人的脸，不要放在另一个角色头顶。
5. 物件框 desc（英文，10–30 词）：具体外观、材质、颜色、状态、和谁有关。
6. 顺序：先大后小，先角色和物件，文字框放最后（越靠后越在前景）。
7. 坐标：画布比例 0–1，(0,0) 左上角，x/y 是左上角，w/h 是宽高。框可以部分重叠，不能完全相同。
8. sections 里：Common 写人数标签（如 2girls / 1boy 1girl）；有 LoRA 的角色把触发词放进 Common；不要在 sections 里写对话内容。`

export const LAYOUT_SCHEMA = `"layout": [{"n": 1, "kind": "char|obj|text", "cid": "A", "speaker": "A", "x": 0, "y": 0, "w": 0, "h": 0, "desc": "...", "text": "只有文字框才有"}]`

// Existing boxes, for edit/review/layout-mode prompts.
export function layoutText(regions: Region[], canvas: { w: number; h: number }): string {
  const f = (n: number) => n.toFixed(2)
  const lines = regions.map((r, i) => {
    const k = r.kind || 'obj'
    const extra = k === 'char' ? ` cid=${r.cid || '?'}` : k === 'text' ? ` speaker=${r.speaker || '无'} 文字「${r.text}」` : ''
    const d = k === 'text' ? r.desc || '' : r.text
    return `n=${i + 1} kind=${k}${extra} x=${f(r.x)} y=${f(r.y)} w=${f(r.w)} h=${f(r.h)}：${d || '（未写）'}`
  })
  return `画布 ${canvas.w}×${canvas.h}。现有画框：\n${lines.join('\n') || '（无）'}`
}

export interface LayoutBox {
  n?: number; kind: 'obj' | 'char' | 'text'; cid?: string; speaker?: string
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
    const kind = b?.kind === 'char' || b?.kind === 'text' ? b.kind : 'obj'
    // legacy {tags:[]} replies
    const desc = str(b?.desc) || (Array.isArray(b?.tags) ? b.tags.map(String).join(', ') : '')
    const n = num(b?.n)
    return {
      n: Number.isFinite(n) ? n : undefined, kind, x, y, w, h, desc,
      cid: kind === 'char' ? str(b?.cid, 4).toUpperCase() || undefined : undefined,
      speaker: kind === 'text' ? str(b?.speaker, 4).toUpperCase() || undefined : undefined,
      text: kind === 'text' ? str(b?.text, 200) : undefined,
    } as LayoutBox
  }).filter((b) => Number.isFinite(b.x) && b.w >= 0.02 && b.h >= 0.02 && (b.kind !== 'text' || b.text)
      && !(b.kind === 'obj' && b.w * b.h > 0.8)) // background boxes belong in tags
    .slice(0, 12)
}

// Where a box is, in English, for speaker hints.
function side(r: { x: number; w: number; y: number; h: number }): string {
  const cx = r.x + r.w / 2
  return cx < 0.4 ? 'on the left' : cx > 0.6 ? 'on the right' : 'in the center'
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
    else { r.text = b.desc; if (b.kind === 'char') r.cid = b.cid }
    return r
  })
  // order: chars/objs first, text boxes last (foreground)
  return [...regs.filter((r) => r.kind !== 'text'), ...regs.filter((r) => r.kind === 'text')]
}

// Final caption for a text box: style + who says it + where that speaker is (computed from boxes).
export function textBoxDesc(r: Region, all: Region[], chars?: Char[]): string {
  const base = (r.desc || '').trim() || 'speech bubble'
  if (!r.speaker) return base
  const sp = all.find((x) => x.kind === 'char' && x.cid === r.speaker)
  const name = chars?.find((c) => c.id === r.speaker)?.name
  const who = `Character ${r.speaker}${name ? ` (${name})` : ''}`
  if (base.includes(`Character ${r.speaker}`)) return sp ? `${base}, ${who} is ${side(sp)}` : base
  return `${base}, spoken by ${who}${sp ? ` who is ${side(sp)}` : ''}`
}
