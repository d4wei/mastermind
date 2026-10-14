import { describe, it, expect } from 'vitest'
import { findLanguage, langLabel, searchLanguages } from '../ui/settings/languages'

describe('language resolution', () => {
  it('resolves the canonical English name', () => {
    expect(findLanguage('Simplified Chinese')?.code).toBe('zh-CN')
  })

  it('resolves explicit language codes', () => {
    expect(findLanguage('en')?.name).toBe('English')
    expect(findLanguage('zh-CN')?.name).toBe('Simplified Chinese')
  })

  it('resolves endonyms and is case-insensitive', () => {
    expect(findLanguage('日本語')?.name).toBe('Japanese')
    expect(findLanguage('ENGLISH')?.name).toBe('English')
  })

  it('labels off-list values as custom, keeping the raw text', () => {
    expect(langLabel('Klingon')).toEqual({ name: 'Klingon', custom: true })
    expect(langLabel('English').custom).toBe(false)
  })
})

describe('searchLanguages', () => {
  it('returns the full list for an empty query', () => {
    expect(searchLanguages('').length).toBeGreaterThan(10)
  })

  it('matches name, endonym, and code', () => {
    expect(searchLanguages('chin').map((l) => l.code)).toEqual(['zh-CN', 'zh-TW'])
    expect(searchLanguages('日本').map((l) => l.code)).toEqual(['ja'])
    expect(searchLanguages('ko').map((l) => l.code)).toContain('ko')
  })

  it('returns nothing for an unmatched query (the custom fallback covers it)', () => {
    expect(searchLanguages('zzzz')).toEqual([])
  })
})
