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
  displayStack,
  fontFaceTokens,
  fontPresetById,
  type CjkLanguage,
  type FontPreset,
} from '../ui/theme/fonts'
import { DEFAULT_CONFIG } from '../ui/settings/defaults'
import { storedConfig } from '../ui/settings/config-values'
import { declarations } from './helpers/themes'

const facesSheet = path.resolve(FONT_FACES_HREF.slice(1))
const declaredFamilies = new Set<string>()
postcss.parse(readFileSync(facesSheet, 'utf8')).walkAtRules('font-face', (rule) => {
  rule.walkDecls('font-family', (decl) => { declaredFamilies.add(decl.value.replace(/^'|'$/g, '')) })
})

const appSheet = postcss.parse(readFileSync('ui/app/app.css', 'utf8'))
const commonTokens = declarations(readFileSync('themes/common.css', 'utf8'))
const STACKS = ['--font-display', '--font-body', '--font-mono'] as const
const SCOPE = ':is(:root, .md-root, .trans-view, .source-host, .md-root [lang], .trans-view [lang])'
const SANS = "&:is([data-font-style='sans'], [data-font-style='sans'] *)"
const LISTS = '&:not(:root)'
/** The `:lang()` rule of each row other than the default, nested in the list rule. */
const ROW_RULES: Partial<Record<CjkLanguage, string>> = {
  ja: '&:lang(ja)', ko: '&:lang(ko)', 'zh-TW': '&:is(:lang(zh-TW), :lang(zh-Hant))', 'zh-HK': '&:is(:lang(zh-HK), :lang(zh-MO))',
}
const quotedList = (families: readonly string[]) => families.map((family) => `'${family}'`).join(', ')

/** A rule's own custom properties, without those of the rules nested in it. */
function ownTokens(rule: postcss.Container): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const node of rule.nodes ?? []) if (node.type === 'decl' && node.prop.startsWith('--')) tokens[node.prop] = node.value
  return tokens
}
function nested(rule: postcss.Container, selector: string): postcss.Rule {
  const found = rule.nodes?.find((node): node is postcss.Rule => node.type === 'rule' && node.selector === selector)
  if (!found) throw new Error(`no nested rule ${selector}`)
  return found
}
function resolve(value: string, tokens: Record<string, string>): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolve(tokens[name]!, tokens))
}

/** The rule that composes the stacks: the only one declaring them. */
function stackRule(): postcss.Rule {
  const declaring = new Set<postcss.Rule>()
  appSheet.walkDecls(/^--font-(display|body|mono)$/, (decl) => {
    let rule = decl.parent as postcss.Rule
    while (rule.parent?.type === 'rule') rule = rule.parent as postcss.Rule
    declaring.add(rule)
  })
  expect(declaring.size).toBe(1)
  return [...declaring][0]!
}

/**
 * The stacks the cascade gives an element under `preset`: the root, or a document element whose
 * language selects `row`. Later nested rules are more specific, so they apply in source order.
 */
function computedStacks(preset: FontPreset, row: CjkLanguage | 'root'): Record<string, string> {
  const rule = stackRule()
  const tokens = { ...commonTokens, ...fontFaceTokens(preset), ...ownTokens(rule) }
  if (preset.style === 'sans') Object.assign(tokens, ownTokens(nested(rule, SANS)))
  if (row !== 'root') {
    const lists = nested(rule, LISTS)
    Object.assign(tokens, ownTokens(lists))
    if (ROW_RULES[row]) Object.assign(tokens, ownTokens(nested(lists, ROW_RULES[row])))
  }
  return Object.fromEntries(STACKS.map((name) => [name, resolve(tokens[name]!, tokens)]))
}

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

  it('lists the CJK faces of each language, per style', () => {
    expect(CJK_LANGUAGES).toEqual(['zh', 'ja', 'zh-TW', 'zh-HK', 'ko'])
    expect(DEFAULT_CJK_LANGUAGE).toBe('zh')
    expect(CJK_STACKS.serif.ja).toEqual(['Noto Serif JP', 'Hiragino Mincho ProN', 'Yu Mincho'])
    expect(CJK_STACKS.sans.ja).toEqual(['Noto Sans JP', 'Hiragino Sans', 'Yu Gothic'])
    expect(CJK_STACKS.serif['zh-HK']).toEqual(['Noto Serif HK', 'Songti TC', 'PMingLiU'])
    expect(CJK_STACKS.sans.ko).toEqual(['Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic'])
  })

  it('composes each element\'s stacks from the preset\'s faces and its language\'s CJK lists', () => {
    expect(stackRule().selector).toBe(SCOPE)
    for (const preset of FONT_PRESETS) {
      const generic = preset.style === 'serif' ? 'serif' : 'sans-serif'
      for (const row of [...CJK_LANGUAGES, 'root'] as const) {
        const language = row === 'root' ? DEFAULT_CJK_LANGUAGE : row
        const cjk = quotedList(CJK_STACKS[preset.style][language])
        // System monospace precedes the CJK faces so Latin code stays monospace if the code face
        // fails; code takes the sans faces of its language in every preset.
        expect(computedStacks(preset, row), `${preset.id} ${row}`).toEqual({
          '--font-display': `'${preset.displayFamily}', ${cjk}, ${generic}`,
          '--font-body': `'${preset.bodyFamily}', ${cjk}, ${generic}`,
          '--font-mono': `'${preset.codeFamily}', ui-monospace, SFMono-Regular, Menlo, Consolas, ${
            quotedList(CJK_STACKS.sans[language])}, monospace`,
        })
      }
    }
  })

  it('switches the CJK lists only in the stack rule, and declares nothing else there', () => {
    const rule = stackRule()
    const shape: string[] = []
    rule.walk((node) => {
      if (node.type === 'rule') shape.push(node.selector)
      if (node.type === 'decl') shape.push(`${(node.parent as postcss.Rule).selector} ${node.prop}`)
    })
    expect(shape.filter((entry) => !entry.includes(' --'))).toEqual([SANS, LISTS, ...Object.values(ROW_RULES)])
    expect(shape.every((entry) => !entry.includes(' --') || /--font-(display|body|mono|cjk-serif|cjk-sans)$/.test(entry)))
      .toBe(true)
    const elsewhere: string[] = []
    appSheet.walkDecls(/^--font-(display|body|mono|cjk)/, (decl) => {
      let node: postcss.Node | undefined = decl
      while (node && node !== rule) node = node.parent as postcss.Node | undefined
      if (!node) elsewhere.push(decl.prop)
    })
    expect(elsewhere).toEqual([])
  })

  it('matches the base tokens to the default preset, every CJK list included', () => {
    for (const [name, value] of Object.entries(fontFaceTokens(DEFAULT_FONT_PRESET))) {
      expect(commonTokens[name], name).toBe(value)
    }
    for (const style of ['serif', 'sans'] as const) {
      for (const language of CJK_LANGUAGES) {
        const token = `--font-cjk-${style}-${language.toLowerCase()}`
        expect(commonTokens[token], token).toBe(quotedList(CJK_STACKS[style][language]))
      }
    }
    expect(commonTokens['--font-cjk-serif']).toBe(`var(--font-cjk-serif-${DEFAULT_CJK_LANGUAGE})`)
    expect(commonTokens['--font-cjk-sans']).toBe(`var(--font-cjk-sans-${DEFAULT_CJK_LANGUAGE})`)
    for (const name of STACKS) expect(commonTokens[name], name).toBeUndefined()
    expect(commonTokens['--weight-bold']).toBe(String(DEFAULT_FONT_PRESET.displayWeight))
    expect(commonTokens['--ls-heading']).toBe(DEFAULT_FONT_PRESET.displayTracking)
    expect(commonTokens['--weight-code']).toBe(String(DEFAULT_FONT_PRESET.codeWeight))
    expect(commonTokens['--weight-body']).toBe('400')
  })

  it('previews each preset\'s headings in its own stack', () => {
    expect(displayStack(fontPresetById('sans'))).toBe("'Source Sans 3', var(--font-cjk-sans), sans-serif")
    expect(resolve(displayStack(DEFAULT_FONT_PRESET), commonTokens)).toBe(computedStacks(DEFAULT_FONT_PRESET, 'root')['--font-display'])
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
    const families: string[] = []
    appSheet.walkRules((rule) => {
      if (rule.selector.replace(/\s+/g, ' ') !== ':where(.md-root [lang])') return
      rule.walkDecls('font-family', (decl) => { families.push(decl.value) })
    })
    expect(families).toEqual(['var(--font-body)'])
  })
})
