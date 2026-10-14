import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { planTranslation, savePreparedTranslation, readPreparedTranslation, translationFile } from '../tools/translation/prepared-translations'
import { createPreview } from '../tools/preview/app'

let dir: string
let file: string
const source = '# Title\n\nHello.\n\n```ts\ncode();\n```\n'
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-prepared-'))
  file = path.join(dir, 'doc.md')
  await fs.writeFile(file, source)
})
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true }) })

async function artifactFor(text = source) {
  const plan = await planTranslation(file, text, 'en', 'zh-CN')
  return { version: 1 as const, sourceHash: plan.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: plan.blocks.filter((b) => b.translatable).map((b) => ({ id: b.id, text: b.kind === 'heading' ? '# 译文标题' : '译文段落。' })) }
}

it('emits all current blocks on every preparation pass regardless of earlier artifacts', async () => {
  const first = await planTranslation(file, source, 'en', 'zh-CN')
  const artifact = await artifactFor()
  await savePreparedTranslation(file, source, 'en', 'zh-CN', artifact)
  const second = await planTranslation(file, source, 'en', 'zh-CN')
  expect(second.blocks).toEqual(first.blocks)
  expect(second.blocks.some((b) => !b.translatable)).toBe(true)
  expect(second.blocks.filter((b) => b.translatable)).toHaveLength(2)
  expect(await readPreparedTranslation(file, source, 'zh-CN')).toEqual({ status: 'ready', artifact })
})

it('replaces an artifact atomically without carrying earlier translations into the result', async () => {
  const first = await artifactFor()
  await savePreparedTranslation(file, source, 'en', 'zh-CN', first)
  const next = { ...first, blocks: first.blocks.map((b) => ({ ...b, text: b.text.startsWith('# ') ? '# 新标题' : '新段落。' })) }
  const rename = vi.spyOn(fs, 'rename')
  await savePreparedTranslation(file, source, 'en', 'zh-CN', next)
  expect(rename).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), translationFile(file, 'zh-CN'))
  expect(JSON.parse(await fs.readFile(translationFile(file, 'zh-CN'), 'utf8'))).toEqual(next)
  expect((await fs.readdir(path.dirname(translationFile(file, 'zh-CN')))).filter((name) => name.endsWith('.tmp'))).toEqual([])
})

it('rejects partial, stale, wrong-language, and legacy artifacts without changing an existing one', async () => {
  const valid = await artifactFor()
  await savePreparedTranslation(file, source, 'en', 'zh-CN', valid)
  const invalid = [
    { ...valid, blocks: valid.blocks.slice(1) },
    { ...valid, sourceHash: 'stale' },
    { ...valid, targetLang: 'fr' },
    { h1: 'old cached map' },
  ]
  for (const input of invalid) await expect(savePreparedTranslation(file, source, 'en', 'zh-CN', input)).rejects.toThrow()
  expect(await readPreparedTranslation(file, source, 'zh-CN')).toEqual({ status: 'ready', artifact: valid })
})

it('rejects a source change while saving the translation and leaves the earlier artifact intact', async () => {
  const valid = await artifactFor()
  await savePreparedTranslation(file, source, 'en', 'zh-CN', valid)
  const originalWrite = fs.writeFile.bind(fs)
  vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
    await originalWrite(...args)
    if (String(args[0]).endsWith('.tmp')) await originalWrite(file, 'Changed narrative')
  })
  await expect(savePreparedTranslation(file, source, 'en', 'zh-CN', valid)).rejects.toThrow('source changed')
  expect(JSON.parse(await fs.readFile(translationFile(file, 'zh-CN'), 'utf8'))).toEqual(valid)
})

it('rejects path-shaped language codes rather than turning them into artifact filenames', async () => {
  await expect(planTranslation(file, source, '', 'zh-CN')).rejects.toThrow()
  expect(() => translationFile(file, '../outside')).toThrow()
})

it('serves only a current prepared artifact and removes live generation and hand-back endpoints', async () => {
  const app = await createPreview(file, path.resolve('themes'))
  const request = (suffix: string, method = 'GET') => app.request(`http://localhost/api/sessions/preview/${suffix}`, {
    method, headers: { host: 'localhost' } })
  {
    expect((await request('translation?targetLang=zh-CN')).status).toBe(404)
    const valid = await artifactFor()
    await savePreparedTranslation(file, source, 'en', 'zh-CN', valid)
    expect(await (await request('translation?targetLang=zh-CN')).json()).toEqual(valid)
    expect((await request('translation?targetLang=../outside')).status).toBe(400)
    await fs.writeFile(file, 'Changed narrative')
    expect((await request('translation?targetLang=zh-CN')).status).toBe(409)
    await fs.unlink(file)
    expect((await request('translation?targetLang=zh-CN')).status).toBe(410)
    expect((await request('handback', 'POST')).status).toBe(404)
    expect((await app.request('http://localhost/api/translate', { method: 'POST', headers: { host: 'localhost' } })).status).toBe(404)
    expect((await app.request('http://localhost/api/assist/pending', { headers: { host: 'localhost' } })).status).toBe(404)
  }
})
