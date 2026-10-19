import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_CONFIG } from '../../ui/settings/defaults'
import { readSessionFile, writeSessionFile } from './files'
import { readPreparedTranslation, listPreparedTranslations, validLanguageCode } from '../translation/prepared-translations'
import { serveFile } from './static'
import { scanThemes } from '../../themes/discovery'

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/** A development preview grants access only to the file selected at startup. */
export async function createPreview(file: string, themesRoot: string): Promise<Hono> {
  const real = await fs.realpath(file)
  if (!(await fs.stat(real)).isFile()) throw new Error('preview requires a regular file')
  const target = { path: real }
  const app = new Hono()
  let config = structuredClone(DEFAULT_CONFIG)
  app.use('*', async (c, next) => {
    if (!LOCAL_HOST.test(c.req.header('host') ?? '')) return c.text('forbidden host', 403)
    const origin = c.req.header('origin')
    if (origin && !LOCAL_ORIGIN.test(origin)) return c.text('forbidden origin', 403)
    await next()
  })
  app.get('/api/config', (c) => c.json(config))
  app.put('/api/config', async (c) => {
    const patch: unknown = await c.req.json().catch(() => null)
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return c.json({ error: 'invalid configuration' }, 400)
    const allowed = Object.fromEntries(Object.entries(patch).filter(([key]) => key in DEFAULT_CONFIG))
    config = { ...config, ...allowed, version: 1 }
    return c.json(config)
  })
  app.get('/api/themes', async (c) => c.json(await scanThemes(themesRoot)))
  app.get('/themes/*', async (c) => (await serveFile(themesRoot, c.req.path.slice('/themes/'.length))) ?? c.notFound())
  app.get('/api/sessions/preview', async (c) => c.json({ sessionId: 'preview', path: real, displayName: path.basename(real), mtimeMs: (await fs.stat(real)).mtimeMs }))
  app.get('/api/sessions/preview/file', async (c) => {
    try { return c.json(await readSessionFile(real)) } catch { return c.json({ error: 'file unreadable' }, 410) }
  })
  app.put('/api/sessions/preview/file', async (c) => {
    const body = await c.req.json<{ content?: unknown; baseVersion?: unknown }>().catch(() => null)
    if (!body || typeof body.content !== 'string' || typeof body.baseVersion !== 'string') return c.json({ error: 'content and baseVersion required' }, 400)
    const result = await writeSessionFile(target, body.content, body.baseVersion)
    return result.ok ? c.json({ mtimeMs: result.mtimeMs, version: result.version }) : c.json({ error: 'file changed on disk', currentMtimeMs: result.currentMtimeMs }, 409)
  })
  app.get('/api/sessions/preview/translations', async (c) => {
    try { return c.json(await listPreparedTranslations(real, (await readSessionFile(real)).content)) }
    catch { return c.json([]) }
  })
  app.get('/api/sessions/preview/translation', async (c) => {
    const lang = c.req.query('targetLang') ?? ''
    if (!validLanguageCode(lang)) return c.json({ error: 'invalid targetLang' }, 400)
    try {
      const source = await readSessionFile(real)
      const result = await readPreparedTranslation(real, source.content, lang)
      if (result.status === 'ready') return c.json(result.artifact)
      return c.json({ error: result.status }, result.status === 'missing' ? 404 : 409)
    } catch { return c.json({ error: 'file unreadable' }, 410) }
  })
  app.get('/api/sessions/preview/events', (c) => streamSSE(c, async (stream) => {
    let running = true
    stream.onAbort(() => { running = false })
    let previous = ''
    let translations = ''
    while (running) {
      try {
        const file = await readSessionFile(real)
        if (previous && previous !== file.version) await stream.writeSSE({ event: 'file-changed', data: JSON.stringify(file) })
        previous = file.version
        const next = JSON.stringify(await listPreparedTranslations(real, file.content))
        if (translations && translations !== next) await stream.writeSSE({ event: 'translations-changed', data: '{}' })
        translations = next
      } catch { await stream.writeSSE({ event: 'file-deleted', data: '{}' }) }
      await stream.sleep(500)
    }
  }))
  return app
}
