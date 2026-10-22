import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import path from 'node:path'
import { createServer } from 'vite'
import { createPreview } from './app'

const ROOT = path.resolve(import.meta.dirname, '../..')

export interface RunningPreview {
  url: string
  close(): Promise<void>
}

/**
 * Starts the file API and the Vite server that proxies to it. Repository paths resolve from this
 * module, so the working directory never matters. Vite's CORS is off so preflights reach the API's
 * origin check instead of being answered by Vite.
 */
export async function startPreview(file: string, apiPort: number, vitePort?: number): Promise<RunningPreview> {
  const app = await createPreview(file, path.join(ROOT, 'themes'))
  const api = await new Promise<{ server: Server; port: number }>((resolve) => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: apiPort },
      (info) => resolve({ server: server as Server, port: info.port }))
  })
  const target = `http://127.0.0.1:${api.port}`
  const vite = await createServer({
    configFile: path.join(ROOT, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: vitePort, cors: false, proxy: { '/api': { target }, '/themes': { target } } },
  })
  await vite.listen()
  return {
    url: `${vite.resolvedUrls?.local[0]}d/preview`,
    async close() {
      await vite.close()
      api.server.closeAllConnections()
      await new Promise((resolve) => api.server.close(resolve))
    },
  }
}
