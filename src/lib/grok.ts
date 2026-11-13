// LLM client. The user configures an OpenAI-compatible base URL + API key in the
// app (DSH-style). Requests go through the local /llm/chat forwarder, which adds
// the Authorization header server-side and avoids browser CORS.
import { settings } from './store'
import type { AiTask } from './types'

export interface ChatOpts {
  task?: AiTask     // picks the per-feature model from settings.routes (falls back to the main AI)
  model?: string
  temperature?: number
  system?: string
  user: string
  images?: string[] // data: URLs (jpeg/png); sent as OpenAI-style image_url parts
}

export async function chat(opts: ChatOpts): Promise<string> {
  const s = settings()
  const r = (opts.task && s.routes?.[opts.task]) || {}
  const baseUrl = r.baseUrl?.trim() || s.baseUrl
  const apiKey = r.apiKey?.trim() || s.apiKey
  const model = r.model?.trim() || opts.model || s.model
  if (!baseUrl) throw new Error('未配置 API 地址，请在设置里填写')
  if (!apiKey) throw new Error('未配置 API Key，请在设置里填写')

  const messages: Array<{ role: string; content: unknown }> = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  if (opts.images?.length) {
    messages.push({
      role: 'user',
      content: [
        ...opts.images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
        { type: 'text', text: opts.user },
      ],
    })
  } else {
    messages.push({ role: 'user', content: opts.user })
  }

  const res = await fetch('/llm/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-base-url': baseUrl,
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? s.temperature,
      messages,
    }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${txt.slice(0, 300)}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('接口返回为空或格式不符')
  return content
}

// Extract the first JSON value (object or array) from a model reply that may
// be wrapped in ```json fences or prose.
export function extractJson<T = unknown>(text: string): T {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  const start = s.search(/[[{]/)
  if (start > 0) s = s.slice(start)
  const open = s[0]
  const close = open === '[' ? ']' : '}'
  let depth = 0, end = -1, inStr = false, esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) { end = i; break } }
  }
  if (end > 0) s = s.slice(0, end + 1)
  return JSON.parse(s) as T
}
