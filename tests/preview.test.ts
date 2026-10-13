import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createPreview } from '../tools/preview/app'
import { serveFile } from '../tools/preview/static'

it('restricts preview requests to localhost and its selected file with checked saves', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-preview-'))
  try {
    const file = path.join(dir, 'doc.md')
    await fs.writeFile(file, 'original\r\n')
    const app = await createPreview(file, path.resolve('themes'))
    const request = (url: string, method = 'GET', body?: object, headers: Record<string, string> = {}) => app.request(url, {
      method, headers: { host: 'localhost', ...headers }, body: body ? JSON.stringify(body) : undefined,
    })
    expect((await request('/api/sessions/preview/file', 'GET', undefined, { host: 'evil.example' })).status).toBe(403)
    expect((await request('/api/sessions/preview/file', 'PUT', {}, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await request('/api/sessions', 'POST', { path: '/etc/passwd' })).status).toBe(404)
    expect((await request('/api/admin/shutdown', 'POST')).status).toBe(404)
    expect((await request('/api/sessions/preview/file', 'PUT', { content: 'unsafe' })).status).toBe(400)
    const base = await (await request('/api/sessions/preview/file')).json() as { version: string }
    expect((await request('/api/sessions/preview/file', 'PUT', { content: 'saved', baseVersion: base.version })).status).toBe(200)
    expect((await request('/api/sessions/preview/file', 'PUT', { content: 'stale', baseVersion: base.version })).status).toBe(409)
    expect(await fs.readFile(file, 'utf8')).toBe('saved')
    await fs.symlink(file, path.join(dir, 'inside.md'))
    expect(await serveFile(dir, 'inside.md')).not.toBeNull()
    await fs.symlink('/etc/passwd', path.join(dir, 'escape.txt'))
    expect(await serveFile(dir, 'escape.txt')).toBeNull()
    expect(await serveFile(dir, '../anything')).toBeNull()
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
