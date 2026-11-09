import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'

const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version

// DSH-style connection: the user enters an OpenAI-compatible base URL + API key
// in the app UI. The browser cannot call most LLM endpoints directly (CORS), so
// the dev server exposes a tiny forwarder at /llm/chat. The frontend sends the
// chosen base URL and key as request headers; this middleware forwards the body
// to `${base}/chat/completions` with the bearer key. The key is never bundled —
// it lives in the user's localStorage and is passed per request.
function llmForwarder(): Plugin {
  return {
    name: 'llm-forwarder',
    configureServer(server) {
      server.middlewares.use('/llm/chat', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('method not allowed')
          return
        }
        const base = String(req.headers['x-base-url'] || '').replace(/\/+$/, '')
        const key = String(req.headers['x-api-key'] || '')
        if (!base) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'missing x-base-url (在设置里填 API 地址)' }))
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', async () => {
          const body = Buffer.concat(chunks) // binary-safe: image payloads are large
          try {
            const r = await fetch(`${base}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(key ? { Authorization: `Bearer ${key}` } : {}),
              },
              body,
            })
            const text = await r.text()
            res.statusCode = r.status
            res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json')
            res.end(text)
          } catch (e: any) {
            res.statusCode = 502
            res.end(JSON.stringify({ error: String(e?.message || e) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  plugins: [vue(), llmForwarder()],
  // Ignore editors' atomic-save temp files; watching them crashed dev with EBUSY.
  server: { port: 5188, watch: { ignored: ['**/*.tmpdir/**', '**/*.tmp'] } },
})
