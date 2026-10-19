import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { planTranslation, savePreparedTranslation, readPreparedTranslation, listPreparedTranslations, translationFile } from '../tools/translation/prepared-translations'

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

it.each(['partial', 'stale', 'wrong-language', 'legacy'])('rejects a %s artifact without changing the previous one', async (kind) => {
  const valid = await artifactFor()
  await savePreparedTranslation(file, source, 'en', 'zh-CN', valid)
  const previous = await fs.readFile(translationFile(file, 'zh-CN'))
  const invalid: Record<string, unknown> = {
    partial: { ...valid, blocks: valid.blocks.slice(1) },
    stale: { ...valid, sourceHash: 'stale' },
    'wrong-language': { ...valid, targetLang: 'fr' },
    legacy: { h1: 'old cached map' },
  }
  await expect(savePreparedTranslation(file, source, 'en', 'zh-CN', invalid[kind])).rejects.toThrow()
  expect(await fs.readFile(translationFile(file, 'zh-CN'))).toEqual(previous)
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
  expect(await fs.readdir(path.dirname(translationFile(file, 'zh-CN')))).toEqual([path.basename(translationFile(file, 'zh-CN'))])
})

it('rejects path-shaped language codes rather than turning them into artifact filenames', async () => {
  await expect(planTranslation(file, source, '', 'zh-CN')).rejects.toThrow()
  expect(() => translationFile(file, '../outside')).toThrow()
})

it.each(['write', 'rename'])('preserves the previous artifact and cleans temporary files after a %s failure', async (operation) => {
  const previous = await artifactFor()
  await savePreparedTranslation(file, source, 'en', 'zh-CN', previous)
  const artifactPath = translationFile(file, 'zh-CN')
  const previousBytes = await fs.readFile(artifactPath)
  const replacement = { ...previous, blocks: previous.blocks.map((block) => ({
    ...block, text: block.text.startsWith('# ') ? '# 新标题' : '新段落。',
  })) }
  if (operation === 'write') {
    const write = fs.writeFile.bind(fs)
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]).endsWith('.tmp')) {
        await write(args[0], 'partial temporary artifact')
        throw new Error('injected artifact write failure')
      }
      await write(...args)
    })
  } else vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('injected artifact rename failure'))
  await expect(savePreparedTranslation(file, source, 'en', 'zh-CN', replacement)).rejects.toThrow(`injected artifact ${operation} failure`)
  expect(await fs.readFile(artifactPath)).toEqual(previousBytes)
  expect(await fs.readdir(path.dirname(artifactPath))).toEqual([path.basename(artifactPath)])
})

it('discovers targets independently and ignores foreign, malformed and redirected artifacts', async () => {
  file = await fs.realpath(file)
  expect(await listPreparedTranslations(file, source)).toEqual([])
  const artifact = await artifactFor()
  await savePreparedTranslation(file, source, 'en', 'zh-CN', artifact)
  const french = { ...artifact, targetLang: 'fr' }
  await savePreparedTranslation(file, source, 'en', 'fr', french)
  await fs.writeFile(translationFile(file, 'ja'), 'invalid')
  await fs.writeFile(translationFile(file, 'de'), JSON.stringify({ ...artifact, targetLang: 'es' }))
  if (process.platform !== 'win32') await fs.symlink(translationFile(file, 'fr'), translationFile(file, 'it'))
  expect((await listPreparedTranslations(file, source)).map((item) => item.targetLang)).toEqual(['fr', 'zh-CN'])
  expect(await listPreparedTranslations(file, 'Changed source')).toEqual([])
  await fs.unlink(translationFile(file, 'fr'))
  expect((await listPreparedTranslations(file, source)).map((item) => item.targetLang)).toEqual(['zh-CN'])
})
