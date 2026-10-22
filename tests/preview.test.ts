import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createPreview } from '../tools/preview/app'
import { serveFile } from '../tools/preview/static'
import { planTranslation, savePreparedTranslation } from '../tools/translation/prepared-translations'

let dir: string
let file: string
let app: Awaited<ReturnType<typeof createPreview>>
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-preview-'))
  file = path.join(dir, 'doc.md')
  await fs.writeFile(file, 'original\r\n')
  app = await createPreview(file, path.resolve('themes'))
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })
function request(url: string, method = 'GET', body?: object, headers: Record<string, string> = {}) {
  return app.request(url, {
    method, headers: { host: 'localhost', ...headers }, body: body ? JSON.stringify(body) : undefined,
  })
}

it('admits only Markdown extensions, including the canonical target', async () => {
  for (const name of ['upper.MD', 'long.Markdown']) {
    const target = path.join(dir, name)
    await fs.writeFile(target, '# Heading')
    await expect(createPreview(target, path.resolve('themes'))).resolves.toBeDefined()
  }
  for (const name of ['notebook.html', 'notes.txt', 'README']) {
    const target = path.join(dir, name)
    await fs.writeFile(target, '# Heading')
    await expect(createPreview(target, path.resolve('themes'))).rejects.toThrow('Markdown file')
  }
  if (process.platform !== 'win32') {
    const alias = path.join(dir, 'alias.md')
    await fs.symlink(path.join(dir, 'notebook.html'), alias)
    await expect(createPreview(alias, path.resolve('themes'))).rejects.toThrow('Markdown file')
  }
})

it('rejects hostile hosts and cross-origin saves without changing the selected file', async () => {
  expect((await request('/api/sessions/preview/file', 'GET', undefined, { host: 'evil.example' })).status).toBe(403)
  expect((await request('/api/sessions/preview/file', 'PUT', {}, { origin: 'https://evil.example' })).status).toBe(403)
  expect(await fs.readFile(file, 'utf8')).toBe('original\r\n')
})

it('admits only the origin of the address the request was sent to', async () => {
  const own = { host: 'localhost:5173' }
  const foreign = { ...own, origin: 'http://localhost:3000' }
  expect((await request('/api/sessions/preview/file', 'GET', undefined, foreign)).status).toBe(403)
  expect((await request('/api/sessions/preview/file', 'OPTIONS', undefined, {
    ...foreign, 'access-control-request-method': 'PUT' })).status).toBe(403)
  expect((await request('/api/sessions/preview/file', 'GET', undefined, { ...own, origin: 'http://127.0.0.1:5173' })).status).toBe(403)
  expect((await request('/api/sessions/preview/file', 'GET', undefined, { ...own, origin: 'http://localhost:5173' })).status).toBe(200)
  expect((await request('/api/sessions/preview/file', 'GET', undefined, own)).status).toBe(200)
})

it('stores only own configuration keys whose values match the default types and a usable author name', async () => {
  const before = await (await request('/api/config')).json()
  for (const patch of [{ theme: 12345 }, { fontSize: '16' }, { uiLang: 'fr' }, { uiLang: 7 }, { authorTag: 'a:b' }, { authorTag: ' padded ' }]) {
    expect((await request('/api/config', 'PUT', patch)).status).toBe(400)
  }
  expect((await request('/api/config', 'PUT', { toString: 'x', constructor: 1, unknown: true })).status).toBe(200)
  expect(await (await request('/api/config')).json()).toEqual(before)
  const saved = await request('/api/config', 'PUT', { theme: 'nacht', fontSize: 18, uiLang: 'zh-CN' })
  expect(await saved.json()).toEqual({ ...before, theme: 'nacht', fontSize: 18, uiLang: 'zh-CN' })
})

it('does not admit another document or expose administrative shutdown', async () => {
  expect((await request('/api/sessions', 'POST', { path: path.join(dir, 'another.md') })).status).toBe(404)
  expect((await request('/api/admin/shutdown', 'POST')).status).toBe(404)
})

it('requires a base version and rejects stale saves after a successful save', async () => {
  expect((await request('/api/sessions/preview/file', 'PUT', { content: 'unsafe' })).status).toBe(400)
  expect(await fs.readFile(file, 'utf8')).toBe('original\r\n')
  const base = await (await request('/api/sessions/preview/file')).json() as { content: string; version: string }
  expect(base.content).toBe('original\r\n')
  expect((await request('/api/sessions/preview/file', 'PUT', { content: 'saved', baseVersion: base.version })).status).toBe(200)
  expect((await request('/api/sessions/preview/file', 'PUT', { content: 'stale', baseVersion: base.version })).status).toBe(409)
  expect(await fs.readFile(file, 'utf8')).toBe('saved')
})

it('reports lossy decoding only for a file that is not valid UTF-8', async () => {
  expect(await (await request('/api/sessions/preview/file')).json()).toMatchObject({ lossy: false })
  await fs.writeFile(file, Buffer.from([0x61, 0xff, 0x0a]))
  expect(await (await request('/api/sessions/preview/file')).json()).toMatchObject({ content: 'a\uFFFD\n', lossy: true })
})

it('refuses a changed save to a file that is not valid UTF-8 and keeps an unchanged save a no-op', async () => {
  const bytes = Buffer.from([0x61, 0xff, 0x62, 0x0a])
  await fs.writeFile(file, bytes)
  const base = await (await request('/api/sessions/preview/file')).json() as { content: string; version: string; lossy: boolean }
  expect(base.lossy).toBe(true)
  const unchanged = await request('/api/sessions/preview/file', 'PUT', { content: base.content, baseVersion: base.version })
  expect(unchanged.status).toBe(200)
  const changed = await request('/api/sessions/preview/file', 'PUT', { content: `${base.content}edit`, baseVersion: base.version })
  expect(changed.status).toBe(422)
  expect(await changed.json()).toEqual({ error: 'not_utf8',
    message: 'The file is not valid UTF-8, so saving would change bytes outside your edits. Use Save As to write a UTF-8 copy.' })
  expect(await fs.readFile(file)).toEqual(bytes)
})

it('serves a contained symlink with exact content', async () => {
  await fs.writeFile(path.join(dir, 'tokens.css'), ':root {}\r\n')
  await fs.symlink(path.join(dir, 'tokens.css'), path.join(dir, 'inside.css'))
  const response = await serveFile(dir, 'inside.css')
  expect(response?.status).toBe(200)
  expect(response?.headers.get('content-type')).toBe('text/css; charset=utf-8')
  expect(await response?.text()).toBe(':root {}\r\n')
})

it('refuses static traversal and symlinks outside the serving root', async () => {
  const root = path.join(dir, 'static')
  await fs.mkdir(root)
  await fs.writeFile(path.join(dir, 'outside.css'), ':root {}')
  await fs.symlink(path.join(dir, 'outside.css'), path.join(root, 'escape.css'))
  expect(await serveFile(root, 'escape.css')).toBeNull()
  expect(await serveFile(root, '../outside.css')).toBeNull()
})

it('serves the theme set the desktop build ships, without sources or docs', async () => {
  const themes = path.resolve('themes')
  expect((await serveFile(themes, 'grid/tokens.css'))?.status).toBe(200)
  expect((await serveFile(themes, 'grid/theme.json'))?.status).toBe(200)
  for (const name of ['README.md', 'discovery.ts', 'types.ts']) expect(await serveFile(themes, name)).toBeNull()
  expect((await request('/themes/README.md')).status).toBe(404)
})

async function saveTranslation() {
  const source = await fs.readFile(file, 'utf8')
  const plan = await planTranslation(file, source, 'en', 'zh-CN')
  const artifact = { version: 1 as const, sourceHash: plan.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: plan.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id, text: '译文段落。' })) }
  await savePreparedTranslation(file, source, 'en', 'zh-CN', artifact)
  return artifact
}

it('serves a complete current prepared translation and reports a missing artifact', async () => {
  expect((await request('/api/sessions/preview/translation?targetLang=zh-CN')).status).toBe(404)
  const artifact = await saveTranslation()
  const response = await request('/api/sessions/preview/translation?targetLang=zh-CN')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(artifact)
})

it('rejects invalid translation paths and detects changed or deleted source files', async () => {
  await saveTranslation()
  expect((await request('/api/sessions/preview/translation?targetLang=../outside')).status).toBe(400)
  await fs.writeFile(file, 'Changed narrative')
  expect((await request('/api/sessions/preview/translation?targetLang=zh-CN')).status).toBe(409)
  await fs.unlink(file)
  expect((await request('/api/sessions/preview/translation?targetLang=zh-CN')).status).toBe(410)
})

it.each([
  ['/api/sessions/preview/handback', 'POST'], ['/api/translate', 'POST'], ['/api/assist/pending', 'GET'],
])('does not expose retired workflow endpoint %s', async (url, method) => {
  expect((await request(url, method)).status).toBe(404)
})
