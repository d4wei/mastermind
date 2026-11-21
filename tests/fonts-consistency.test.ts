import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import {
  CJK_LANGUAGES,
  CJK_STACKS,
  DEFAULT_CJK_LANGUAGE,
  DEFAULT_FONT_PRESET,
  FONT_FACES_HREF,
  FONT_PRESETS,
  LANGUAGE_SCOPE,
  bodyStack,
  cjkListToken,
  cjkListTokens,
  displayStack,
  fontPresetById,
  fontStackRule,
  fontStackTokens,
  monoStack,
} from '../ui/theme/fonts'
import { DEFAULT_CONFIG } from '../ui/settings/defaults'
import { storedConfig } from '../ui/settings/config-values'
import { declarations } from './helpers/themes'

const facesSheet = path.resolve(FONT_FACES_HREF.slice(1))
const declaredFamilies = new Set<string>()
postcss.parse(readFileSync(facesSheet, 'utf8')).walkAtRules('font-face', (rule) => {
  rule.walkDecls('font-family', (decl) => { declaredFamilies.add(decl.value.replace(/^'|'$/g, '')) })
})

describe('font presets', () => {
  it('offers exactly the serif, sans, and hyperlegible presets, with serif the default', () => {
    expect(FONT_PRESETS.map((preset) => preset.id)).toEqual(['serif', 'sans', 'hyperlegible'])
    expect(DEFAULT_FONT_PRESET.id).toBe('serif')
    expect(DEFAULT_CONFIG.fontPreset).toBe('serif')
  })

  it('names only faces the bundled sheet declares, and bundles the Simplified Chinese and Japanese faces', () => {
    for (const preset of FONT_PRESETS) {
      const named = [preset.displayFamily, preset.bodyFamily, preset.codeFamily]
      for (const family of named) expect(declaredFamilies.has(family), `${preset.id} "${family}"`).toBe(true)
    }
    for (const style of ['serif', 'sans'] as const) {
      for (const language of CJK_LANGUAGES) {
        const lead = CJK_STACKS[style][language][0]
        expect(lead, `${style} ${language}`).toMatch(/^Noto (Serif|Sans) (SC|JP|TC|HK|KR)$/)
        // Traditional Chinese and Korean fall through to system faces until their packs arrive.
        expect(declaredFamilies.has(lead), `${style} ${language}`).toBe(language === 'zh' || language === 'ja')
      }
    }
  })

  it('stacks each language after the Latin face, per style', () => {
    expect(CJK_LANGUAGES).toEqual(['zh', 'ja', 'zh-TW', 'zh-HK', 'ko'])
    expect(DEFAULT_CJK_LANGUAGE).toBe('zh')
    expect(CJK_STACKS.serif.ja).toEqual(['Noto Serif JP', 'Hiragino Mincho ProN', 'Yu Mincho'])
    expect(CJK_STACKS.sans.ja).toEqual(['Noto Sans JP', 'Hiragino Sans', 'Yu Gothic'])
    expect(CJK_STACKS.serif['zh-HK']).toEqual(['Noto Serif HK', 'Songti TC', 'PMingLiU'])
    expect(CJK_STACKS.sans.ko).toEqual(['Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic'])
    for (const preset of FONT_PRESETS) {
      for (const language of CJK_LANGUAGES) {
        const cjk = CJK_STACKS[preset.style][language].map((family) => `'${family}'`).join(', ')
        const generic = preset.style === 'serif' ? 'serif' : 'sans-serif'
        expect(bodyStack(preset, language)).toBe(`'${preset.bodyFamily}', ${cjk}, ${generic}`)
        expect(displayStack(preset, language)).toBe(`'${preset.displayFamily}', ${cjk}, ${generic}`)
        // System monospace precedes the CJK faces so Latin code stays monospace if the bundled face fails;
        // code takes the sans faces of its language in every preset.
        const sans = CJK_STACKS.sans[language].map((family) => `'${family}'`).join(', ')
        expect(monoStack(preset, language)).toBe(
          `'${preset.codeFamily}', ui-monospace, SFMono-Regular, Menlo, Consolas, ${sans}, monospace`)
      }
      expect(bodyStack(preset)).toBe(bodyStack(preset, 'zh'))
      expect(monoStack(preset)).toBe(monoStack(preset, 'zh'))
    }
  })

  it('composes three stacks around the CJK lists of the language in force', () => {
    const lists = cjkListTokens()
    expect(Object.keys(lists)).toHaveLength(2 * CJK_LANGUAGES.length)
    for (const preset of FONT_PRESETS) {
      const tokens = fontStackTokens(preset)
      expect(Object.keys(tokens)).toEqual(['--font-display', '--font-body', '--font-mono'])
      for (const language of CJK_LANGUAGES) {
        const resolve = (value: string) => value
          .replace('var(--font-cjk-serif)', lists[cjkListToken('serif', language)]!)
          .replace('var(--font-cjk-sans)', lists[cjkListToken('sans', language)]!)
        expect(resolve(tokens['--font-display']!), `${preset.id} ${language}`).toBe(displayStack(preset, language))
        expect(resolve(tokens['--font-body']!), `${preset.id} ${language}`).toBe(bodyStack(preset, language))
        expect(resolve(tokens['--font-mono']!), `${preset.id} ${language}`).toBe(monoStack(preset, language))
      }
    }
  })

  it('declares the stacks on the elements whose `:lang()` rules switch only the two CJK lists', () => {
    const scope = `:is(${LANGUAGE_SCOPE.join(', ')})`
    expect(fontStackRule(DEFAULT_FONT_PRESET).split(' {')[0]).toBe(`:root, ${LANGUAGE_SCOPE.join(', ')}`)
    const switches = new Map<string, Record<string, string>>()
    postcss.parse(readFileSync('ui/app/app.css', 'utf8')).walkRules((rule) => {
      const declared: Record<string, string> = {}
      rule.walkDecls(/^--font-/, (decl) => { declared[decl.prop] = decl.value })
      if (Object.keys(declared).length) switches.set(rule.selector, declared)
    })
    const rows: Record<string, string> = {
      '': 'zh', ':lang(ja)': 'ja', ':lang(ko)': 'ko', ':is(:lang(zh-TW), :lang(zh-Hant))': 'zh-TW', ':is(:lang(zh-HK), :lang(zh-MO))': 'zh-HK',
    }
    expect([...switches.keys()]).toEqual(Object.keys(rows).map((suffix) => `${scope}${suffix}`))
    for (const [suffix, language] of Object.entries(rows)) {
      expect(switches.get(`${scope}${suffix}`), language).toEqual({
        '--font-cjk-serif': `var(${cjkListToken('serif', language as typeof CJK_LANGUAGES[number])})`,
        '--font-cjk-sans': `var(${cjkListToken('sans', language as typeof CJK_LANGUAGES[number])})`,
      })
    }
  })

  it('matches the base tokens to the default preset, every CJK list included', () => {
    const tokens = declarations(readFileSync('themes/common.css', 'utf8'))
    for (const [name, value] of Object.entries({ ...fontStackTokens(DEFAULT_FONT_PRESET), ...cjkListTokens() })) {
      expect(tokens[name], name).toBe(value)
    }
    expect(tokens['--font-cjk-serif']).toBe(`var(${cjkListToken('serif', DEFAULT_CJK_LANGUAGE)})`)
    expect(tokens['--font-cjk-sans']).toBe(`var(${cjkListToken('sans', DEFAULT_CJK_LANGUAGE)})`)
    expect(tokens['--weight-bold']).toBe(String(DEFAULT_FONT_PRESET.displayWeight))
    expect(tokens['--ls-heading']).toBe(DEFAULT_FONT_PRESET.displayTracking)
    expect(tokens['--weight-code']).toBe(String(DEFAULT_FONT_PRESET.codeWeight))
    expect(tokens['--weight-body']).toBe('400')
  })

  it('reads a removed or unknown preset as the default and drops the retired code font', () => {
    expect(fontPresetById('grid')).toBe(DEFAULT_FONT_PRESET)
    expect(fontPresetById(undefined)).toBe(DEFAULT_FONT_PRESET)
    expect(storedConfig({ fontPreset: 'grid', monoFont: 'jetbrains' })).toEqual(DEFAULT_CONFIG)
    expect(storedConfig({ fontPreset: 'hyperlegible' }).fontPreset).toBe('hyperlegible')
    expect(storedConfig({ monoFont: 'geist' })).not.toHaveProperty('monoFont')
  })
})

describe('language-tagged blocks', () => {
  it('re-declare the body family, since an inherited family is computed before their stack switches', () => {
    const sheet = postcss.parse(readFileSync(path.resolve('ui/app/app.css'), 'utf8'))
    const families: string[] = []
    sheet.walkRules((rule) => {
      if (rule.selector.replace(/\s+/g, ' ') !== ':where(.md-root [lang])') return
      rule.walkDecls('font-family', (decl) => { families.push(decl.value) })
    })
    expect(families).toEqual(['var(--font-body)'])
  })
})
