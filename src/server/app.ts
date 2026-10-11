import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SSE_PING_INTERVAL_MS } from '../shared/constants'
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  FileMeta,
  FileResponse,
  HealthResponse,
  ReviewCounts,
  SessionMeta,
  SseEventName,
  TreeEntry,
  TreeResponse,
  WorkspaceMeta,
  WorkspaceSessionInfo,
} from '../shared/types'
import { readConfig, redactConfig, updateConfig, type ConfigPatch } from './config'
import { relWithin, resolveWithin } from './contain'
import { readSessionFile, writeSessionFile } from './files'
import { detectBrowsers } from './browsers'
import { scanThemes } from './themes'
import { readPreparedTranslation, validLanguageCode } from './translate/prepared'
import { startWatcher, stopWatcher } from './watch'
import { group, reviewCounts } from '../shared/critic/scanner'
import { scanMarkdown } from '../shared/markdown/scan'
import { log } from './log'
import { themesDir, uiDir } from './paths'
import { type Conn, SessionRegistry } from './sessions'
import { serveFile } from './static'
import type { WorkspaceRegistry } from './workspaces'

export interface AppDeps {
  registry: SessionRegistry
  workspaces: WorkspaceRegistry
  version: string
  startedAt: number
  requestShutdown: (reason: string) => void
  touch: () => void
}

const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/
const LOCAL_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

/** Tree entries never shown: VCS/tool dirs, deps, and every dotfile. */
const WORKSPACE_DENYLIST = new Set(['node_modules', '.git', '.mastermind'])
function isHiddenEntry(name: string): boolean {
  return name.startsWith('.') || WORKSPACE_DENYLIST.has(name)
}

/**
 * Lazy per-file review badge, cached by (realpath, mtimeMs) so a static tree
 * doesn't re-scan on every viewport pass. Counts come from active review marks.
 */
const fileMetaCache = new Map<string, FileMeta>()
async function workspaceFileMeta(rel: string, real: string, mtimeMs: number): Promise<FileMeta> {
  const key = `${real}\0${mtimeMs}`
  const hit = fileMetaCache.get(key)
  if (hit) return hit
  let counts: ReviewCounts | null = null
  if (real.toLowerCase().endsWith('.md')) {
    try {
      const body = await fs.readFile(real, 'utf8')
      counts = reviewCounts(group(scanMarkdown(body), body))
    } catch {
      counts = null
    }
  }
  const meta: FileMeta = { rel, counts, mtimeMs }
  fileMetaCache.set(key, meta)
  return meta
}

export function createApp(deps: AppDeps): Hono {
  const { registry, workspaces } = deps
  const app = new Hono()

  // Guards: localhost-only Host (DNS rebinding) and same-machine Origin for writes (CSRF).
  app.use('*', async (c, next) => {
    deps.touch()
    const host = c.req.header('host') ?? ''
    if (!LOCAL_HOST_RE.test(host)) return c.text('forbidden host', 403)
    const origin = c.req.header('origin')
    if (origin && c.req.method !== 'GET' && !LOCAL_ORIGIN_RE.test(origin)) {
      return c.text('forbidden origin', 403)
    }
    await next()
  })

  app.get('/api/health', (c) => {
    const body: HealthResponse = {
      ok: true,
      pid: process.pid,
      version: deps.version,
      startedAt: deps.startedAt,
    }
    return c.json(body)
  })

  app.post('/api/admin/shutdown', (c) => {
    setTimeout(() => deps.requestShutdown('admin request'), 20)
    return c.body(null, 202)
  })

  app.get('/api/config', (c) => c.json(redactConfig(readConfig())))

  app.put('/api/config', async (c) => {
    let patch: ConfigPatch
    try {
      patch = await c.req.json<ConfigPatch>()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    let next
    try { next = updateConfig(patch) } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'invalid configuration' }, 400)
    }
    for (const session of registry.all()) {
      registry.broadcast(session.id, 'config-changed', {})
    }
    return c.json(redactConfig(next))
  })

  app.get('/api/themes', async (c) => c.json(await scanThemes()))

  app.get('/api/browsers', (c) => c.json(detectBrowsers()))

  app.get('/api/sessions/:id/translation', async (c) => {
    const session = registry.get(c.req.param('id'))
    if (!session) return c.json({ error: 'session not found' }, 404)
    const targetLang = c.req.query('targetLang') ?? ''
    if (!validLanguageCode(targetLang)) return c.json({ error: 'invalid targetLang' }, 400)
    try {
      const { content } = await readSessionFile(session.path)
      const prepared = await readPreparedTranslation(session.path, content, targetLang)
      if (prepared.status === 'missing') return c.json({ error: 'missing' }, 404)
      if (prepared.status === 'stale') return c.json({ error: 'stale' }, 409)
      return c.json(prepared.artifact)
    } catch {
      return c.json({ error: 'file unreadable' }, 410)
    }
  })

  app.post('/api/sessions', async (c) => {
    let body: CreateSessionRequest
    try {
      body = await c.req.json<CreateSessionRequest>()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    let real: string
    let isDraft = false
    if (body.draft) {
      // blank draft: eagerly create untitled.md (one session model — real
      // path, real watcher); renamed on first save, unlinked if left empty
      const dir = body.dir ? path.resolve(body.dir) : os.homedir()
      const dirStat = await fs.stat(dir).catch(() => null)
      if (!dirStat?.isDirectory()) return c.json({ error: `not a directory: ${dir}` }, 400)
      let name = 'untitled.md'
      for (let n = 2; ; n++) {
        try {
          await fs.writeFile(path.join(dir, name), '', { flag: 'wx' })
          break
        } catch {
          name = `untitled-${n}.md`
        }
      }
      real = await fs.realpath(path.join(dir, name))
      isDraft = true
    } else {
      if (!body.path) return c.json({ error: 'path is required' }, 400)
      try {
        real = await fs.realpath(path.resolve(body.path))
      } catch {
        return c.json({ error: `file not found: ${body.path}` }, 404)
      }
      const st = await fs.stat(real)
      if (!st.isFile()) return c.json({ error: `not a file: ${real}` }, 400)
    }

    const { session, created } = registry.open(real, { isDraft })
    const resp: CreateSessionResponse = {
      sessionId: session.id,
      url: `http://${c.req.header('host')}/d/${session.id}`,
      created,
      isDraft: session.isDraft,
    }
    return c.json(resp)
  })

  app.get('/api/sessions/:id', async (c) => {
    const session = registry.get(c.req.param('id'))
    if (!session) return c.json({ error: 'session not found' }, 404)
    let mtimeMs = 0
    try {
      mtimeMs = (await fs.stat(session.path)).mtimeMs
    } catch {
      /* deleted on disk — still report the session */
    }
    const meta: SessionMeta = {
      sessionId: session.id,
      path: session.path,
      displayName: session.displayName,
      isDraft: session.isDraft,
      mtimeMs,
    }
    return c.json(meta)
  })

  app.get('/api/sessions/:id/file', async (c) => {
    const session = registry.get(c.req.param('id'))
    if (!session) return c.json({ error: 'session not found' }, 404)
    try {
      const body: FileResponse = await readSessionFile(session.path)
      return c.json(body)
    } catch {
      return c.json({ error: 'file unreadable (deleted?)' }, 410)
    }
  })

  app.put('/api/sessions/:id/file', async (c) => {
    const session = registry.get(c.req.param('id'))
    if (!session) return c.json({ error: 'session not found' }, 404)
    let body: { content?: string; baseVersion?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    if (typeof body.content !== 'string') return c.json({ error: 'content is required' }, 400)
    if (typeof body.baseVersion !== 'string') return c.json({ error: 'baseVersion is required' }, 400)
    const result = await writeSessionFile(session, body.content, body.baseVersion)
    if (!result.ok) {
      return c.json({ error: 'file changed on disk', currentMtimeMs: result.currentMtimeMs }, 409)
    }
    // a save can change mark counts — refresh any workspace tree showing this file
    workspaces.notifyForPath(session.path, 'file-badge-changed')
    return c.json({ mtimeMs: result.mtimeMs, version: result.version })
  })

  app.post('/api/sessions/:id/rename', async (c) => {
    const session = registry.get(c.req.param('id'))
    if (!session) return c.json({ error: 'session not found' }, 404)
    let body: { filename?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    let name = path.basename((body.filename ?? '').trim())
    if (!name || name === '.md' || name.startsWith('.')) return c.json({ error: 'invalid filename' }, 400)
    if (!name.endsWith('.md')) name += '.md'
    const target = path.join(path.dirname(session.path), name)
    const exists = await fs.stat(target).then(
      () => true,
      () => false,
    )
    if (exists) return c.json({ error: `${name} already exists`, code: 'exists' }, 409)

    await stopWatcher(session)
    await fs.rename(session.path, target)
    const real = await fs.realpath(target)
    registry.rekey(session, real)
    session.isDraft = false
    startWatcher(session, registry)
    log(`session ${session.id}: renamed to ${real}`)
    return c.json({ path: real, displayName: session.displayName, ...(await readSessionFile(real)) })
  })

  // --- workspaces (file tree) ---
  //
  // A workspace is a read-only directory context. Every filesystem touch below
  // goes through resolveWithin() — the single containment chokepoint — so a
  // tree click can never read outside the root it was opened on.

  app.post('/api/workspaces', async (c) => {
    let body: CreateWorkspaceRequest
    try {
      body = await c.req.json<CreateWorkspaceRequest>()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    if (!body.root) return c.json({ error: 'root is required' }, 400)
    let root: string
    try {
      root = await fs.realpath(path.resolve(body.root))
    } catch {
      return c.json({ error: `directory not found: ${body.root}` }, 404)
    }
    if (!(await fs.stat(root)).isDirectory()) return c.json({ error: `not a directory: ${root}` }, 400)
    const ws = workspaces.open(root)
    const resp: CreateWorkspaceResponse = {
      workspaceId: ws.id,
      url: `http://${c.req.header('host')}/w/${ws.id}`,
      root: ws.root,
      displayName: ws.displayName,
    }
    return c.json(resp)
  })

  app.get('/api/workspaces/:wid', (c) => {
    const ws = workspaces.get(c.req.param('wid'))
    if (!ws) return c.json({ error: 'workspace not found' }, 404)
    const meta: WorkspaceMeta = { workspaceId: ws.id, root: ws.root, displayName: ws.displayName }
    return c.json(meta)
  })

  // one directory level (client recurses lazily — bounds cost on big trees)
  app.get('/api/workspaces/:wid/tree', async (c) => {
    const ws = workspaces.get(c.req.param('wid'))
    if (!ws) return c.json({ error: 'workspace not found' }, 404)
    const dir = c.req.query('dir') ?? ''
    const real = await resolveWithin(ws.root, dir)
    if (!real) return c.json({ error: 'forbidden path' }, 403)
    let dirents
    try {
      dirents = await fs.readdir(real, { withFileTypes: true })
    } catch {
      return c.json({ error: 'not a directory' }, 404)
    }
    const entries: TreeEntry[] = []
    for (const d of dirents) {
      if (isHiddenEntry(d.name)) continue
      const rel = dir ? `${dir}/${d.name}` : d.name
      let isDir = d.isDirectory()
      // a symlink must itself resolve back inside the root, or it's dropped
      if (d.isSymbolicLink()) {
        const target = await resolveWithin(ws.root, rel)
        if (!target) continue
        try {
          isDir = (await fs.stat(target)).isDirectory()
        } catch {
          continue
        }
      }
      entries.push({ name: d.name, rel, isDir, isMarkdown: !isDir && d.name.toLowerCase().endsWith('.md') })
    }
    // directories first, then case-insensitive by name
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    const resp: TreeResponse = { dir, entries }
    return c.json(resp)
  })

  app.get('/api/workspaces/:wid/file-meta', async (c) => {
    const ws = workspaces.get(c.req.param('wid'))
    if (!ws) return c.json({ error: 'workspace not found' }, 404)
    const rel = c.req.query('path') ?? ''
    const real = await resolveWithin(ws.root, rel)
    if (!real) return c.json({ error: 'forbidden path' }, 403)
    let st
    try {
      st = await fs.stat(real)
    } catch {
      return c.json({ error: 'unreadable' }, 410)
    }
    if (!st.isFile()) return c.json({ error: 'not a file' }, 400)
    return c.json(await workspaceFileMeta(rel, real, st.mtimeMs))
  })

  // Include sessions from other tabs whose files belong to this workspace.
  app.get('/api/workspaces/:wid/sessions', (c) => {
    const ws = workspaces.get(c.req.param('wid'))
    if (!ws) return c.json({ error: 'workspace not found' }, 404)
    const out: WorkspaceSessionInfo[] = []
    for (const s of registry.all()) {
      const rel = relWithin(ws.root, s.path)
      if (rel === null) continue
      out.push({
        rel,
        sessionId: s.id,
        isDraft: s.isDraft,
      })
    }
    return c.json(out)
  })

  app.get('/api/workspaces/:wid/events', (c) => {
    const wid = c.req.param('wid')
    if (!workspaces.get(wid)) return c.json({ error: 'workspace not found' }, 404)
    return streamSSE(c, async (stream) => {
      let open = true
      const conn: Conn = {
        role: 'ui',
        send: async (event: SseEventName, data: unknown) => {
          await stream.writeSSE({ event, data: JSON.stringify(data) })
        },
        close: () => {
          open = false
          void stream.close()
        },
      }
      stream.onAbort(() => {
        open = false
        workspaces.detach(wid, conn)
      })
      if (!workspaces.attach(wid, conn)) {
        open = false
        return
      }
      log(`sse ui connected to workspace ${wid}`)
      while (open) {
        await stream.sleep(SSE_PING_INTERVAL_MS)
        if (!open) break
        try {
          await stream.writeSSE({ event: 'ping', data: '{}' })
        } catch {
          open = false
        }
      }
      workspaces.detach(wid, conn)
    })
  })

  app.get('/api/sessions/:id/events', (c) => {
    const sessionId = c.req.param('id')
    if (!registry.get(sessionId)) return c.json({ error: 'session not found' }, 404)

    return streamSSE(c, async (stream) => {
      let open = true
      const conn: Conn = {
        role: 'ui',
        send: async (event: SseEventName, data: unknown) => {
          await stream.writeSSE({ event, data: JSON.stringify(data) })
        },
        close: () => {
          open = false
          void stream.close()
        },
      }
      stream.onAbort(() => {
        open = false
        registry.detach(sessionId, conn)
      })
      if (!registry.attach(sessionId, conn)) {
        open = false
        return
      }
      log(`sse ui connected to session ${sessionId}`)
      while (open) {
        await stream.sleep(SSE_PING_INTERVAL_MS)
        if (!open) break
        try {
          await stream.writeSSE({ event: 'ping', data: '{}' })
        } catch {
          open = false
        }
      }
      registry.detach(sessionId, conn)
    })
  })

  // --- static: themes, built UI, SPA fallback ---

  app.get('/themes/*', async (c) => {
    const rel = c.req.path.replace(/^\/themes\//, '')
    const res = await serveFile(themesDir, rel, 'no-cache')
    return res ?? c.notFound()
  })

  app.get('/assets/*', async (c) => {
    const rel = c.req.path.replace(/^\//, '')
    const res = await serveFile(uiDir, rel, 'immutable')
    return res ?? c.notFound()
  })

  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound()
    // exact static file (favicon etc.), else SPA fallback to index.html
    const rel = c.req.path.replace(/^\//, '')
    if (rel && !rel.includes('..') && path.extname(rel)) {
      const res = await serveFile(uiDir, rel, 'no-cache')
      if (res) return res
      return c.notFound()
    }
    const index = await serveFile(uiDir, 'index.html', 'no-store')
    return index ?? c.text('mastermind: UI not built — run npm run build', 500)
  })

  return app
}
