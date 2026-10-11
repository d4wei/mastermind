import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readConfig, updateConfig } from '../src/server/config'
import { parseAuthor } from '../src/shared/critic/scanner'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-author-'))
  vi.stubEnv('MASTERMIND_CONFIG_DIR', dir)
  vi.mocked(execFileSync).mockReset().mockReturnValue('Alex Chen\n')
})
afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('default review author', () => {
  it('uses the global Git name on a new install, without writing during a read', () => {
    expect(readConfig().authorTag).toBe('Alex-Chen')
    expect(execFileSync).toHaveBeenCalledWith('git', ['config', '--global', '--get', 'user.name'], {
      encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'],
    })
    expect(fs.existsSync(path.join(dir, 'config.json'))).toBe(false)
  })

  it.each(['ke', 'custom-name'])('preserves the configured tag %j without invoking Git', (authorTag) => {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ authorTag }))
    expect(readConfig().authorTag).toBe(authorTag)
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('fills an absent author tag without changing other preferences', () => {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ theme: 'sepia' }))
    expect(readConfig()).toMatchObject({ theme: 'sepia', authorTag: 'Alex-Chen' })
  })

  it.each(['', ' \n ', '@:{}<>'])('uses a neutral fallback for an unusable Git name %j', (name) => {
    vi.mocked(execFileSync).mockReturnValue(name)
    expect(readConfig().authorTag).toBe('reviewer')
  })

  it('falls back when Git is missing, unconfigured, or times out', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('Git unavailable') })
    expect(readConfig().authorTag).toBe('reviewer')
  })

  it.each(['李 明', 'Alex: {>>@admin: hi<<}', 'a'.repeat(100)])(
    'produces a scanner-readable tag from %j', (name) => {
      vi.mocked(execFileSync).mockReturnValue(name)
      const tag = readConfig().authorTag
      expect(tag.length).toBeLessThanOrEqual(64)
      expect(parseAuthor(`@${tag}: comment`)).toEqual({ author: tag, body: 'comment' })
      expect(tag).not.toMatch(/[{}<>]/)
    },
  )

  it('persists an explicit override and preserves it across later config edits', () => {
    updateConfig({ authorTag: 'my-tag' })
    vi.mocked(execFileSync).mockReturnValue('Another Name')
    updateConfig({ theme: 'nacht' })
    expect(readConfig()).toMatchObject({ authorTag: 'my-tag', theme: 'nacht' })
  })
})


it('defaults to original-only reading and persists an explicit optional translation language', () => {
  expect(readConfig().translationLanguage).toBeNull()
  expect(updateConfig({ translationLanguage: 'zh-CN' }).translationLanguage).toBe('zh-CN')
  expect(readConfig().translationLanguage).toBe('zh-CN')
  expect(updateConfig({ translationLanguage: null }).translationLanguage).toBeNull()
  expect(() => updateConfig({ translationLanguage: '../outside' })).toThrow('language code')
})

it('does not expose the retired language pair from existing preference JSON', () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ authorTag: 'Alex', langPair: { a: 'en', b: 'zh' } }))
  expect(readConfig()).not.toHaveProperty('langPair')
  expect(readConfig().translationLanguage).toBeNull()
})

it('reads earlier preference names without rewriting the file, then saves canonical keys', () => {
  const file = path.join(dir, 'config.json')
  const original = '{ "authorTag": "Alex", "comfortLang": "zh-CN", "typeSet": "lora", "fontSize": 18 }\r\n'
  fs.writeFileSync(file, original)
  expect(readConfig()).toMatchObject({ translationLanguage: 'zh-CN', fontPreset: 'lora', fontSize: 18 })
  expect(readConfig()).not.toHaveProperty('comfortLang')
  expect(readConfig()).not.toHaveProperty('typeSet')
  expect(fs.readFileSync(file, 'utf8')).toBe(original)
  updateConfig({ theme: 'sepia' })
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  expect(saved).toMatchObject({ translationLanguage: 'zh-CN', fontPreset: 'lora', fontSize: 18, theme: 'sepia' })
  expect(saved).not.toHaveProperty('comfortLang')
  expect(saved).not.toHaveProperty('typeSet')
  expect(readConfig()).toEqual(saved)
})

it.each([null, 'ja'])('prefers canonical language %j and font keys over earlier names', (translationLanguage) => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    authorTag: 'Alex', translationLanguage, comfortLang: 'zh-CN', fontPreset: 'geist', typeSet: 'lora',
  }))
  expect(readConfig()).toMatchObject({ translationLanguage, fontPreset: 'geist' })
})

it.each([
  { comfortLang: '../outside', typeSet: null },
  { translationLanguage: '../outside', comfortLang: 'zh-CN', fontPreset: null, typeSet: 'lora' },
])('normalizes unusable preference values without reviving shadowed names: %j', (preferences) => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ authorTag: 'Alex', ...preferences }))
  expect(readConfig()).toMatchObject({ translationLanguage: null, fontPreset: 'grid' })
})

it.each([null, [], 'not preferences'])('uses defaults for non-object preference JSON: %j', (value) => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(value))
  expect(readConfig()).toMatchObject({ translationLanguage: null, fontPreset: 'grid' })
})

it.each([
  null, [], { comfortLang: 'ja' }, { typeSet: 'lora' }, { version: 2 },
  { fontPreset: null }, { fontPreset: '' }, { translationLanguage: 42 },
])('rejects invalid or retired update fields without touching saved preferences: %j', (patch) => {
  const file = path.join(dir, 'config.json')
  updateConfig({ translationLanguage: 'zh-CN', fontPreset: 'lora' })
  const original = fs.readFileSync(file, 'utf8')
  expect(() => updateConfig(patch as never)).toThrow()
  expect(fs.readFileSync(file, 'utf8')).toBe(original)
})
