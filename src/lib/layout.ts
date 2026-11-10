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

export const LAYOUT_SPEC = `【画框布局规范】（ComfyUI MOSS-Image 官方画框节点，每个框单独编码，框的描述就是该区域的提示词）
1. 框的类型 kind：
   - "panel" 分镜格：漫画/多格/分镜/四格时使用。每一格一个框，所有格子必须拼满整个画布（格间留 1/32 以内的缝），不能有大片空白。
   - "char" 角色：角色每出现一次就一个框（同一角色在不同格里出现就画多个框，cid 相同）。框住这一格里看得到的身体部分。
   - "obj" 物件：只给重要的道具、动物、载具、建筑主体。
   - "text" 文字：每一句对话 / 招牌 / 标题一个框。
2. 背景不画框：天空、地面、房间、远景、光照、氛围写进 sections（Background & Lighting 等）。分镜格的背景写在 panel 的 desc 里。
3. panel 的 desc（英文 15–40 词）：开头 "Comic panel 2 of 4, "，再写镜头（extreme close-up / close-up / medium shot / full body / wide shot）、角度、这一格里谁在做什么、这一格的背景。每格镜头要有变化，特写格要明确写 close-up 和特写的部位。
4. char 的 desc（英文 25–60 词）：开头 "Character A, "；有 LoRA 触发词时紧接着写触发词；在分镜里再写 "in panel 2, "。然后写服装、姿势、动作、表情、朝向/视线（朝向谁）、手里的东西。
   - 角色框要和镜头匹配：特写格里角色框占满大半格，全身格里框住全身。
   - 多个角色靠服装、动作、位置明显区分，绝不混写到一个框。同一角色在各格服装保持一致。
   - 有 LoRA 的角色不写发色、瞳色、耳朵、尾巴、体型等先天外貌，只写服装、姿势、动作、表情。没有 LoRA 的角色可以写外貌。
5. text 文字框：
   - text = 实际画出来的文字（保持原语言，对话 ≤12 字或 ≤6 个英文单词）。
   - speaker = 说话角色的 cid；招牌/标题留空。
   - 说话人必须在同一格里有自己的 char 框，气泡放在那个 char 框头部上方或侧上方，紧挨着，不盖住任何人的脸，不放到另一个角色头顶，不能跨格。
   - desc（英文）= 气泡/字体样式 + "the tail points to Character A's mouth"。
6. obj 的 desc（英文 10–30 词）：外观、材质、颜色、状态、和谁有关。
7. 顺序：panel 在最前，然后 char 和 obj，text 放最后（越靠后越在前景）。
8. 坐标：画布比例 0–1，(0,0) 左上角，x/y 是左上角，w/h 是宽高。主体要占满画面，不留无意义的空白。
9. sections：Common 写人数标签（如 2girls）和 comic、multiple panels 等格式标签；有 LoRA 的角色把触发词放进 Common；不要在 sections 里写对话内容。`

export const LAYOUT_SCHEMA = `"layout": [{"n": 1, "kind": "panel|char|obj|text", "cid": "A", "speaker": "A", "x": 0, "y": 0, "w": 0, "h": 0, "desc": "...", "text": "只有文字框才有"}]`

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
  n?: number; kind: 'obj' | 'char' | 'text' | 'panel'; cid?: string; speaker?: string
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
    const kind = ['char', 'text', 'panel'].includes(b?.kind) ? b.kind : 'obj'
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
    .slice(0, 40)
}

const ctr = (r: Region) => [r.x + r.w / 2, r.y + r.h / 2]
const inside = (p: number[], r: Region) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h
export function panelOf(r: Region, all: Region[]): Region | undefined {
  const c = ctr(r)
  return all.filter((x) => x.kind === 'panel' && inside(c, x)).sort((a, b) => a.w * a.h - b.w * b.h)[0]
}
// the speaker's char box closest to a text box (same panel first)
export function speakerBox(t: Region, all: Region[]): Region | undefined {
  const pn = panelOf(t, all)
  const c = ctr(t)
  const d = (r: Region) => { const q = ctr(r); return Math.hypot(q[0] - c[0], q[1] - c[1]) }
  const cands = all.filter((x) => x.kind === 'char' && x.cid === t.speaker)
  const same = pn ? cands.filter((x) => panelOf(x, all) === pn) : cands
  return (same.length ? same : cands).sort((a, b) => d(a) - d(b))[0]
}
function side(r: Region, frame?: Region): string {
  const f = frame || { x: 0, w: 1 }
  const cx = (r.x + r.w / 2 - f.x) / f.w
  return cx < 0.4 ? 'on the left' : cx > 0.6 ? 'on the right' : 'in the center'
}

// Problems a user should fix before exporting (speaker missing, blank canvas…)
export function checkLayout(all: Region[]): string[] {
  const out: string[] = []
  all.forEach((t, i) => {
    if (t.kind !== 'text' || !t.speaker) return
    const sp = speakerBox(t, all)
    if (!sp) out.push(`#${i + 1}「${t.text}」的说话人 ${t.speaker} 没有角色框`)
    else if (panelOf(t, all) && panelOf(sp, all) !== panelOf(t, all)) out.push(`#${i + 1}「${t.text}」和说话人 ${t.speaker} 不在同一格`)
  })
  // coverage on a 20×20 grid (text boxes don't count)
  let hit = 0
  for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) {
    const p = [(a + 0.5) / 20, (b + 0.5) / 20]
    if (all.some((r) => r.kind !== 'text' && inside(p, r))) hit++
  }
  if (all.length && hit < 400 * 0.6) out.push(`画面只有 ${Math.round(hit / 4)}% 被角色/物件/分镜框覆盖，空白较多`)
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
    else { r.text = b.desc; if (b.kind === 'char') r.cid = b.cid }
    return r
  })
  // order: chars/objs first, text boxes last (foreground)
  const rank = (r: Region) => (r.kind === 'panel' ? 0 : r.kind === 'text' ? 2 : 1)
  return regs.map((r, i) => [r, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r)
}

// Final caption for a text box: style + who says it + where that speaker is (computed from boxes).
export function textBoxDesc(r: Region, all: Region[], chars?: Char[]): string {
  const base = (r.desc || '').trim() || 'speech bubble'
  if (!r.speaker) return base
  const sp = speakerBox(r, all)
  const pn = sp ? panelOf(sp, all) : undefined
  const name = chars?.find((c) => c.id === r.speaker)?.name
  const who = `Character ${r.speaker}${name ? ` (${name})` : ''}`
  const pIdx = pn ? all.filter((x) => x.kind === 'panel').indexOf(pn) + 1 : 0
  const where = sp ? ` ${side(sp, pn)}${pIdx ? ` of panel ${pIdx}` : ''}` : ''
  if (base.includes(`Character ${r.speaker}`)) return sp ? `${base}, ${who} is${where}` : base
  return `${base}, spoken by ${who}${sp ? ` who is${where}` : ''}`
}
