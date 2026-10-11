import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSessionFile, writeSessionFile } from '../src/server/files'
import { SessionRegistry, type Session } from '../src/server/sessions'
import { createApp } from '../src/server/app'
import { WorkspaceRegistry } from '../src/server/workspaces'

let dir: string
let file: string
let session: Session
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-save-'))
  file = path.join(dir, 'document.md')
  await fs.writeFile(file, 'original\r\n')
  session = { path: file, lastSelfWriteHash: null } as Session
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('guarded file writes', () => {
  it('serializes competing saves so only one stale-base write succeeds', async () => {
    const base = await readSessionFile(file)
    const results = await Promise.all([
      writeSessionFile(session, 'first', base.version),
      writeSessionFile(session, 'second', base.version),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(await fs.readFile(file, 'utf8')).toBe(results[0]!.ok ? 'first' : 'second')
  })

  it('serializes saves through canonical and symlink paths together', async () => {
    const link = path.join(dir, 'alias.md')
    await fs.symlink(file, link)
    const base = await readSessionFile(file)
    const results = await Promise.all([
      writeSessionFile(session, 'canonical', base.version),
      writeSessionFile({ ...session, path: link }, 'alias', base.version),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(await fs.readFile(file, 'utf8')).toBe(results[0]!.ok ? 'canonical' : 'alias')
  })

  it('requires a version on HTTP saves and retires the hand-back route', async () => {
    const registry = new SessionRegistry()
    const opened = registry.open(await fs.realpath(file)).session
    const app = createApp({ registry, workspaces: new WorkspaceRegistry(), version: 'test', startedAt: 0, requestShutdown() {}, touch() {} })
    const url = `http://localhost/api/sessions/${opened.id}`
    const request = (route: string, content: object) => app.request(`${url}/${route}`, {
      method: route === 'file' ? 'PUT' : 'POST',
      headers: { host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(content),
    })
    try {
      expect((await request('file', { content: 'unsafe' })).status).toBe(400)
      expect((await request('handback', { content: 'unsafe' })).status).toBe(404)
      const base = await (await app.request(`${url}/file`, { headers: { host: 'localhost' } })).json() as { version: string }
      const saved = await request('file', { content: 'saved', baseVersion: base.version })
      expect(saved.status).toBe(200)
      expect((await saved.json() as { version: string }).version).not.toBe(base.version)
      expect((await request('file', { content: 'stale', baseVersion: base.version })).status).toBe(409)
      expect(await fs.readFile(file, 'utf8')).toBe('saved')
    } finally {
      registry.closeAll('shutdown')
    }
  })

  it('refuses a deleted file without recreating it', async () => {
    const base = await readSessionFile(file)
    await fs.unlink(file)
    expect(await writeSessionFile(session, 'local', base.version)).toEqual({ ok: false, currentMtimeMs: null })
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('detects same-mtime edits', async () => {
    const fixedTime = new Date('2020-01-01T00:00:00Z')
    await fs.utimes(file, fixedTime, fixedTime)
    const base = await readSessionFile(file)
    await fs.writeFile(file, 'external\r\n')
    await fs.utimes(file, fixedTime, fixedTime)
    expect((await fs.stat(file)).mtimeMs).toBe(base.mtimeMs)
    expect((await writeSessionFile(session, 'local', base.version)).ok).toBe(false)
    expect(await fs.readFile(file, 'utf8')).toBe('external\r\n')
  })

  it('detects a replacement even when its bytes and mtime match', async () => {
    const base = await readSessionFile(file)
    const replacement = path.join(dir, 'replacement.md')
    await fs.writeFile(replacement, base.content)
    await fs.utimes(replacement, base.mtimeMs / 1000, base.mtimeMs / 1000)
    await fs.rename(replacement, file)
    expect((await writeSessionFile(session, 'local', base.version)).ok).toBe(false)
    expect(await fs.readFile(file, 'utf8')).toBe(base.content)
  })

  it('reports a replacement after writing even when replacement content matches', async () => {
    const base = await readSessionFile(file)
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args)
      if (args[1] === 'r+') {
        const truncate = handle.truncate.bind(handle)
        vi.spyOn(handle, 'truncate').mockImplementation(async (length) => {
          await truncate(length)
          const replacement = path.join(dir, 'replacement.md')
          await fs.writeFile(replacement, 'local')
          await fs.rename(replacement, file)
        })
      }
      return handle
    })
    expect((await writeSessionFile(session, 'local', base.version)).ok).toBe(false)
    expect(session.lastSelfWriteHash).toBeNull()
  })

  it('preserves symlinks, permissions, and verbatim multilingual bytes', async () => {
    const link = path.join(dir, 'link.md')
    await fs.symlink(file, link)
    await fs.chmod(file, 0o640)
    const linkedSession = { ...session, path: link }
    const base = await readSessionFile(link)
    const content = '文档\r\n{>>@ke: 更多细节<<}\r\n'
    const saved = await writeSessionFile(linkedSession, content, base.version)
    expect(saved.ok).toBe(true)
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o640)
    expect(await fs.readFile(file)).toEqual(Buffer.from(content))
  })

  it('preserves existing summary blocks as ordinary source content', async () => {
    const source = '# Review\r\n\r\n<!-- mastermind:summary -->\r\n> Earlier review summary\r\n<!-- /mastermind:summary -->\r\n'
    await fs.writeFile(file, source)
    const opened = await readSessionFile(file)
    expect(opened.content).toBe(source)
    expect((await writeSessionFile(session, opened.content, opened.version)).ok).toBe(true)
    expect(await fs.readFile(file, 'utf8')).toBe(source)
  })

  it('leaves unedited bytes and version intact', async () => {
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0xff])
    await fs.writeFile(file, bytes)
    const base = await readSessionFile(file)
    expect(await writeSessionFile(session, base.content, base.version)).toEqual({ ok: true, mtimeMs: base.mtimeMs, version: base.version })
    expect(await fs.readFile(file)).toEqual(bytes)
  })

  it('rejects a read whose descriptor changes while reading', async () => {
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args)
      const read = handle.readFile.bind(handle)
      vi.spyOn(handle, 'readFile').mockImplementation(async () => {
        const bytes = await read()
        await fs.writeFile(file, 'changed during read')
        return bytes
      })
      return handle
    })
    await expect(readSessionFile(file)).rejects.toThrow('file changed during read')
  })
})
