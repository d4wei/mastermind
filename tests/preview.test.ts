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

it('rejects hostile hosts and cross-origin saves without changing the selected file', async () => {
  expect((await request('/api/sessions/preview/file', 'GET', undefined, { host: 'evil.example' })).status).toBe(403)
  expect((await request('/api/sessions/preview/file', 'PUT', {}, { origin: 'https://evil.example' })).status).toBe(403)
  expect(await fs.readFile(file, 'utf8')).toBe('original\r\n')
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

it('serves a contained symlink with exact content', async () => {
  await fs.symlink(file, path.join(dir, 'inside.md'))
  const response = await serveFile(dir, 'inside.md')
  expect(response?.status).toBe(200)
  expect(await response?.text()).toBe('original\r\n')
})

it('refuses static traversal and symlinks outside the serving root', async () => {
  const root = path.join(dir, 'static')
  await fs.mkdir(root)
  await fs.symlink(file, path.join(root, 'escape.md'))
  expect(await serveFile(root, 'escape.md')).toBeNull()
  expect(await serveFile(root, '../doc.md')).toBeNull()
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
