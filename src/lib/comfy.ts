// ComfyUI bridge for the official nodes CreateBoundingBoxes → MOSSImageLayoutPrompt (comfy-core).
// Element format (read by CreateBoundingBoxes' "bboxes" input, see comfy_extras/nodes_bounding_boxes.py):
//   [{type:'obj'|'text', bbox:[ymin,xmin,ymax,xmax] (0–1000), desc, text?}]
// Normalized coords are resolution-independent, so the workflow's own width/height still apply.
import type { Char, PromptSet, Region } from './types'
import { textBoxDesc, charBoxDesc } from './layout'

export interface ComfyElement { type: 'obj' | 'text'; bbox: number[]; desc: string; text?: string }

const g = (v: number) => Math.max(0, Math.min(1000, Math.round(v * 1000)))

// caption sent for a box
export function boxDesc(r: Region, all: Region[], chars?: Char[]): string {
  return r.kind === 'text' ? textBoxDesc(r, all, chars) : r.kind === 'char' ? charBoxDesc(r, chars) : r.text
}

export function regionsToElements(regions: Region[], chars?: Char[]): ComfyElement[] {
  return regions.map((r) => {
    const bbox = [g(r.y), g(r.x), g(r.y + r.h), g(r.x + r.w)]
    if (r.kind === 'text') return { type: 'text', bbox, text: r.text, desc: boxDesc(r, regions, chars) }
    return { type: 'obj', bbox, desc: boxDesc(r, regions, chars) }
  })
}

// "1, 3" — 1-based numbers of character boxes, as MOSSImageLayoutPrompt.character_boxes expects
export function characterBoxes(regions: Region[]): string {
  return regions.map((r, i) => (r.kind === 'char' ? i + 1 : 0)).filter(Boolean).join(', ')
}

// Full MOSS layout prompt, same JSON as MOSSImageLayoutPrompt outputs (pixels from canvas centre, yxyx);
// paste straight into the text encoder. firstLine (e.g. an artist LoRA trigger) goes on line 1.
export function mossJson(s: PromptSet, caption: string, firstLine = ''): string {
  const W = s.canvas?.w || 1024, H = s.canvas?.h || 1024
  const regs = s.regions || []
  const items = regs.map((r) => {
    const label = r.kind === 'text' ? 'text' : r.kind === 'char' ? 'character' : 'object'
    const it: Record<string, unknown> = { label, caption: boxDesc(r, regs, s.chars) }
    if (label === 'text') it.text = r.text
    it.bbox = [Math.floor(r.y * H) - (H >> 1), Math.floor(r.x * W) - (W >> 1),
      Math.ceil((r.y + r.h) * H) - (H >> 1), Math.ceil((r.x + r.w) * W) - (W >> 1)]
    return it
  })
  const body = JSON.stringify({ summary: { caption: caption.trim() }, items, bbox_coord_space: 'abs_centralized', bbox_format: 'yxyx' }, null, 2)
  return firstLine.trim() ? firstLine.trim() + '\n' + body : body
}

export function elementsJson(s: PromptSet): string {
  return JSON.stringify(regionsToElements(s.regions || [], s.chars), null, 2)
}

// ---------- workflow injection ----------
const TPL_KEY = 'prompt-studio-comfy-template'
export function loadTemplate(): { name: string; json: string } | null {
  try { return JSON.parse(localStorage.getItem(TPL_KEY) || 'null') } catch { return null }
}
export function saveTemplate(name: string, json: string) {
  JSON.parse(json) // validate
  localStorage.setItem(TPL_KEY, JSON.stringify({ name, json }))
}

type Graph = { nodes: any[]; links: any[]; id?: string; inputs?: any[]; state?: any }
type Link = { id: number; o: number; os: number; t: number; ts: number }

function linksOf(gr: Graph): Link[] {
  return (gr.links || []).map((l: any) =>
    Array.isArray(l) ? { id: l[0], o: l[1], os: l[2], t: l[3], ts: l[4] }
      : { id: l.id, o: l.origin_id, os: l.origin_slot, t: l.target_id, ts: l.target_slot })
}
function graphs(wf: any): Graph[] {
  return [wf, ...((wf.definitions?.subgraphs || []) as Graph[])]
}
// widget order per schema (used when the node's inputs list doesn't carry widget entries)
const WIDGET_ORDER: Record<string, string[]> = {
  MOSSImageLayoutPrompt: ['prompt', 'width', 'height', 'character_boxes'],
  CreateBoundingBoxes: ['width', 'height', 'editor_state', 'last_incoming'],
}
// index into widgets_values for a widget input; null when it can't be trusted
function widgetIndex(node: any, name: string): number | null {
  if (!Array.isArray(node.widgets_values)) return null
  const order = WIDGET_ORDER[node.type]
  if (order && node.widgets_values.length === order.length) return order.indexOf(name) >= 0 ? order.indexOf(name) : null
  const ws = (node.inputs || []).filter((i: any) => i.widget)
  const i = ws.findIndex((w: any) => w.widget.name === name)
  if (i < 0) return null
  // extra entries (e.g. seed "control_after_generate") break positional mapping before them
  const extra = node.widgets_values.length - ws.length
  if (extra !== 0 && ws.slice(0, i).some((w: any) => /seed|noise/.test(w.widget.name))) return null
  return i
}

const PRIMS = /^Primitive(String|StringMultiline|Int|Float)$|^PrimitiveNode$/

// Set a widget input of `node` in graph `gr` — follows links to primitives and subgraph instances.
function setInput(wf: any, gr: Graph, node: any, name: string, value: any, log: string[], depth = 0): boolean {
  if (depth > 6) return false
  const inp = (node.inputs || []).find((i: any) => i.name === name)
  const link = inp?.link != null ? linksOf(gr).find((l) => l.id === inp.link) : undefined
  if (!link) {
    const i = widgetIndex(node, name)
    if (i == null) return false
    node.widgets_values[i] = value
    return true
  }
  if (link.o === -10 && gr !== wf) {
    // comes from the subgraph's input → set it on every instance
    const sgIn = gr.inputs?.[link.os]
    if (!sgIn) return false
    let ok = false
    for (const pg of graphs(wf)) for (const n of pg.nodes || [])
      if (n.type === gr.id) ok = setInput(wf, pg, n, sgIn.name, value, log, depth + 1) || ok
    return ok
  }
  const src = (gr.nodes || []).find((n: any) => n.id === link.o)
  if (src && PRIMS.test(src.type) && Array.isArray(src.widgets_values)) {
    src.widgets_values[0] = value
    return true
  }
  log.push(`「${name}」由上游节点 ${src?.type || '?'} 控制，未修改`)
  return false
}

function nextIds(wf: any) {
  let node = Number(wf.last_node_id) || 0, link = Number(wf.last_link_id) || 0
  for (const gr of graphs(wf)) {
    for (const n of gr.nodes || []) node = Math.max(node, Number(n.id) || 0)
    for (const l of linksOf(gr)) link = Math.max(link, Number(l.id) || 0)
    if (gr.state) { node = Math.max(node, gr.state.lastNodeId || 0); link = Math.max(link, gr.state.lastLinkId || 0) }
  }
  return { node: node + 1, link: link + 1 }
}
function bumpIds(wf: any, node: number, link: number) {
  wf.last_node_id = Math.max(wf.last_node_id || 0, node)
  wf.last_link_id = Math.max(wf.last_link_id || 0, link)
  for (const gr of graphs(wf)) if (gr.state) {
    gr.state.lastNodeId = Math.max(gr.state.lastNodeId || 0, node)
    gr.state.lastLinkId = Math.max(gr.state.lastLinkId || 0, link)
  }
}

export interface InjectResult { json: string; log: string[] }

export function injectWorkflow(template: string, s: PromptSet, prompt: string): InjectResult {
  const wf = JSON.parse(template)
  const log: string[] = []
  const regions = s.regions || []
  const els = regionsToElements(regions, s.chars)
  const elText = JSON.stringify(els)

  // --- CreateBoundingBoxes ---
  let found: { gr: Graph; n: any } | null = null
  let count = 0
  for (const gr of graphs(wf)) for (const n of gr.nodes || [])
    if (n.type === 'CreateBoundingBoxes') { count++; found ||= { gr, n } }
  if (!found) throw new Error('模板里没有「Create Bounding Boxes」节点')
  if (count > 1) log.push(`有 ${count} 个画框节点，只填了第一个`)
  const { gr, n: cbb } = found

  // editor_state (pixels) so the canvas shows the boxes right away; widgets: width,height,editor_state,last_incoming
  const wv = Array.isArray(cbb.widgets_values) ? cbb.widgets_values : (cbb.widgets_values = [1024, 1024, [], []])
  const W = Number(wv[0]) || 1024, H = Number(wv[1]) || 1024
  const wLinked = (cbb.inputs || []).find((i: any) => i.name === 'width')?.link != null
  if (!wLinked && s.canvas) {
    wv[0] = s.canvas.w; wv[1] = s.canvas.h
    log.push(`画布尺寸 ${s.canvas.w}×${s.canvas.h}`)
  } else if (wLinked && s.canvas) log.push(`尺寸由工作流上游决定（工具里为 ${s.canvas.w}×${s.canvas.h}），框按比例自动适配`)
  const cw = !wLinked && s.canvas ? s.canvas.w : W, ch = !wLinked && s.canvas ? s.canvas.h : H
  wv[2] = regions.map((r) => ({
    x: Math.round(r.x * cw), y: Math.round(r.y * ch), width: Math.round(r.w * cw), height: Math.round(r.h * ch),
    metadata: { type: r.kind === 'text' ? 'text' : 'obj', text: r.kind === 'text' ? r.text : '',
      desc: boxDesc(r, regions, s.chars), palette: [] },
  }))
  wv[3] = [] // last_incoming empty → next run re-initializes from the bboxes input

  // bboxes input ← multiline text node with normalized elements (resolution-independent)
  const bIn = (cbb.inputs || []).find((i: any) => i.name === 'bboxes')
  const bSlot = (cbb.inputs || []).indexOf(bIn)
  const lk = bIn?.link != null ? linksOf(gr).find((l) => l.id === bIn.link) : undefined
  const srcNode = lk ? gr.nodes.find((x: any) => x.id === lk.o) : null
  if (srcNode && /^PrimitiveString/.test(srcNode.type)) {
    srcNode.widgets_values = [elText]
  } else if (bIn && bSlot >= 0) {
    if (lk) { // unlink whatever was there
      gr.links = gr.links.filter((l: any) => (Array.isArray(l) ? l[0] : l.id) !== lk.id)
      const on = gr.nodes.find((x: any) => x.id === lk.o)
      const out = on?.outputs?.[lk.os]
      if (out?.links) out.links = out.links.filter((i: number) => i !== lk.id)
      log.push('已断开画框节点 bboxes 原有连线')
    }
    const ids = nextIds(wf)
    const pos = Array.isArray(cbb.pos) ? [cbb.pos[0] - 420, cbb.pos[1]] : [0, 0]
    gr.nodes.push({
      id: ids.node, type: 'PrimitiveStringMultiline', pos, size: [380, 220], flags: {}, order: 0, mode: 0,
      title: 'PromptStudio 画框',
      inputs: [{ name: 'value', type: 'STRING', widget: { name: 'value' }, link: null }],
      outputs: [{ name: 'STRING', type: 'STRING', links: [ids.link] }],
      properties: { 'Node name for S&R': 'PrimitiveStringMultiline' },
      widgets_values: [elText],
    })
    if (gr === wf) gr.links.push([ids.link, ids.node, 0, cbb.id, bSlot, 'STRING'])
    else gr.links.push({ id: ids.link, origin_id: ids.node, origin_slot: 0, target_id: cbb.id, target_slot: bSlot, type: 'STRING' })
    bIn.link = ids.link
    bumpIds(wf, ids.node, ids.link)
    log.push('已添加「PromptStudio 画框」文本节点并接到 bboxes')
  } else log.push('画框节点缺少 bboxes 输入，只写入了画布框（请更新 ComfyUI）')
  log.push(`写入 ${els.length} 个框`)

  // --- MOSSImageLayoutPrompt ---
  let moss: { gr: Graph; n: any } | null = null
  for (const g2 of graphs(wf)) for (const n of g2.nodes || []) if (!moss && n.type === 'MOSSImageLayoutPrompt') moss = { gr: g2, n }
  if (moss) {
    const chars = characterBoxes(regions)
    if (setInput(wf, moss.gr, moss.n, 'prompt', prompt, log)) log.push('已填正向提示词')
    else log.push('正向提示词未能自动填写')
    if (setInput(wf, moss.gr, moss.n, 'character_boxes', chars, log)) log.push(`角色框：${chars || '无'}`)
  } else log.push('没找到 MOSS-Image Layout Prompt 节点，提示词未填')

  return { json: JSON.stringify(wf), log }
}

export function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
