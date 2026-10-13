import { serve } from '@hono/node-server'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createServer } from 'vite'
import { createPreview } from './app'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { file: { type: 'string' }, port: { type: 'string', default: '5199' } } })
const file = values.file ?? positionals[0]
if (!file || positionals.length > 1) throw new Error('Usage: npm run dev -- FILE [--port PORT]')
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid preview port')
const app = await createPreview(path.resolve(file), path.resolve('themes'))
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port })
const vite = await createServer({ server: { host: '127.0.0.1', proxy: {
  '/api': { target: `http://127.0.0.1:${port}` }, '/themes': { target: `http://127.0.0.1:${port}` },
} } })
await vite.listen()
console.log(`Development preview: ${vite.resolvedUrls?.local[0]}d/preview`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  server.close()
  void vite.close()
})
