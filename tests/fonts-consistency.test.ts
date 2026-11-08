import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import {
  CJK_STACKS,
  DEFAULT_FONT_PRESET,
  FONT_FACES_HREF,
  FONT_PRESETS,
  bodyStack,
  displayStack,
  fontPresetById,
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

  it('names only faces the bundled sheet declares', () => {
    for (const preset of FONT_PRESETS) {
      const named = [preset.displayFamily, preset.bodyFamily, preset.codeFamily, ...CJK_STACKS[preset.style].slice(0, 1)]
      for (const family of named) expect(declaredFamilies.has(family), `${preset.id} "${family}"`).toBe(true)
    }
  })

  it('carries the preset CJK stack in the body and display stacks', () => {
    for (const preset of FONT_PRESETS) {
      const cjk = CJK_STACKS[preset.style].map((family) => `'${family}'`).join(', ')
      expect(bodyStack(preset)).toBe(`'${preset.bodyFamily}', ${cjk}, ${preset.style === 'serif' ? 'serif' : 'sans-serif'}`)
      expect(displayStack(preset)).toContain(`'${preset.displayFamily}', ${cjk}, `)
      expect(monoStack(preset)).toMatch(new RegExp(`^'${preset.codeFamily}', 'Noto Sans SC', .*monospace$`))
    }
  })

  it('matches the base tokens to the default preset', () => {
    const tokens = declarations(readFileSync('themes/common.css', 'utf8'))
    expect(tokens['--font-display']).toBe(displayStack(DEFAULT_FONT_PRESET))
    expect(tokens['--font-body']).toBe(bodyStack(DEFAULT_FONT_PRESET))
    expect(tokens['--font-mono']).toBe(monoStack(DEFAULT_FONT_PRESET))
    expect(tokens['--weight-bold']).toBe(String(DEFAULT_FONT_PRESET.displayWeight))
    expect(tokens['--ls-heading']).toBe(DEFAULT_FONT_PRESET.displayTracking)
    expect(tokens['--weight-code']).toBe(String(DEFAULT_FONT_PRESET.codeWeight))
  })

  it('reads a removed or unknown preset as the default and drops the retired code font', () => {
    expect(fontPresetById('grid')).toBe(DEFAULT_FONT_PRESET)
    expect(fontPresetById(undefined)).toBe(DEFAULT_FONT_PRESET)
    expect(storedConfig({ fontPreset: 'grid', monoFont: 'jetbrains' })).toEqual(DEFAULT_CONFIG)
    expect(storedConfig({ fontPreset: 'hyperlegible' }).fontPreset).toBe('hyperlegible')
    expect(storedConfig({ monoFont: 'geist' })).not.toHaveProperty('monoFont')
  })
})
