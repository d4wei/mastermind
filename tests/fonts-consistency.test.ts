import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  FONT_FACES,
  FONT_PRESETS,
  MONO_FONTS,
  fontPresetById,
  monoById,
  DEFAULT_FONT_PRESET,
  DEFAULT_MONO,
} from '../ui/theme/fonts'

describe('font registry', () => {
  const families = new Set(FONT_FACES.map((f) => f.family))

  it('every font preset references declared display + body families', () => {
    for (const s of FONT_PRESETS) {
      expect(families.has(s.displayFamily), `${s.id} display "${s.displayFamily}"`).toBe(true)
      expect(families.has(s.bodyFamily), `${s.id} body "${s.bodyFamily}"`).toBe(true)
    }
  })

  it('every mono option references a declared family', () => {
    for (const m of MONO_FONTS) expect(families.has(m.family), `${m.id} "${m.family}"`).toBe(true)
  })

  it('every declared face has a vendored woff2 on disk', () => {
    for (const f of FONT_FACES) {
      const rel = f.url.replace(/^\/themes\//, '')
      const path = fileURLToPath(new URL(`../themes/${rel}`, import.meta.url))
      expect(existsSync(path), `${f.family} → ${f.url}`).toBe(true)
    }
  })

  it('defaults resolve, and unknown ids fall back to the first option', () => {
    expect(fontPresetById(DEFAULT_FONT_PRESET).id).toBe(DEFAULT_FONT_PRESET)
    expect(monoById(DEFAULT_MONO).id).toBe(DEFAULT_MONO)
    expect(fontPresetById('nope').id).toBe(FONT_PRESETS[0]!.id)
    expect(monoById('nope').id).toBe(MONO_FONTS[0]!.id)
  })
})
