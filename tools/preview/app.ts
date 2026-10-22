import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_CONFIG } from '../../ui/settings/defaults'
import type { MastermindConfig } from '../../ui/settings/types'
import { readSessionFile, writeSessionFile } from './files'
import { readPreparedTranslation, listPreparedTranslations, validLanguageCode } from '../translation/prepared-translations'
import { serveFile } from './static'
import { scanThemes } from '../../themes/discovery'

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
// Keyed by the union so a new interface language fails to compile until it is admitted here.
const UI_LANGUAGES: Record<MastermindConfig['uiLang'], true> = { en: true, 'zh-CN': true }

/** Admits known keys whose values have the default's type; null rejects the whole patch. */
function configPatch(patch: object): Partial<MastermindConfig> | null {
  const accepted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) continue
    if (typeof value !== typeof DEFAULT_CONFIG[key as keyof MastermindConfig]) return null
    if (key === 'uiLang' && !Object.hasOwn(UI_LANGUAGES, value as string)) return null
    accepted[key] = value
  }
  return accepted
}

export interface PreviewOptions {
  /** Interval between checks of the selected file and its prepared translations. */
  pollMs?: number
}

/**
 * A development preview grants access only to the file selected at startup. A request carrying an
 * Origin must come from the address it was sent to, so pages served on other local ports are refused.
 */
export async function createPreview(file: string, themesRoot: string, { pollMs = 500 }: PreviewOptions = {}): Promise<Hono> {
  const real = await fs.realpath(file)
  if (!(await fs.stat(real)).isFile()) throw new Error('preview requires a regular file')
  if (![file, real].every((name) => /\.(md|markdown)$/i.test(name))) {
    throw new Error('Choose a Markdown file (.md or .markdown).')
  }
  const target = { path: real }
  const app = new Hono()
  let config = structuredClone(DEFAULT_CONFIG)
  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? ''
    if (!LOCAL_HOST.test(host)) return c.text('forbidden host', 403)
    const origin = c.req.header('origin')
    if (origin !== undefined && origin !== `http://${host}`) return c.text('forbidden origin', 403)
    await next()
  })
  app.get('/api/config', (c) => c.json(config))
  app.put('/api/config', async (c) => {
    const patch: unknown = await c.req.json().catch(() => null)
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return c.json({ error: 'invalid configuration' }, 400)
    const accepted = configPatch(patch)
    if (!accepted) return c.json({ error: 'invalid configuration' }, 400)
    config = { ...config, ...accepted, version: 1 }
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
    let deleted = false
    while (running) {
      const missing = await fs.stat(real).then(() => false, (error: NodeJS.ErrnoException) => error.code === 'ENOENT')
      if (missing) {
        if (!deleted) await stream.writeSSE({ event: 'file-deleted', data: '{}' })
        deleted = true
      } else {
        try {
          const file = await readSessionFile(real)
          if (previous && previous !== file.version) await stream.writeSSE({ event: 'file-changed', data: JSON.stringify(file) })
          previous = file.version
          deleted = false
          const next = JSON.stringify(await listPreparedTranslations(real, file.content))
          if (translations && translations !== next) await stream.writeSSE({ event: 'translations-changed', data: '{}' })
          translations = next
        } catch { /* A save racing this read, or another transient failure, is retried on the next tick. */ }
      }
      await stream.sleep(pollMs)
    }
  }))
  return app
}
