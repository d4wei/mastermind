import { describe, expect, it } from 'vitest'
import { maskSource, pickSentinels } from '../document/critic/mask'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { scan } from '../document/critic/scanner'

describe('maskSource', () => {
  it('preserves length exactly', () => {
    const text = 'a {++ins++} b {~~old~>new~~} c {>>note 中文 𐍈<<} d'
    const { masked } = maskSource(text, scan(text))
    expect(masked.length).toBe(text.length)
  })

  it('replaces ins delimiters with sentinel runs, keeps content', () => {
    const text = 'x {++keep **bold**++} y'
    const { masked, sentinels } = maskSource(text, scan(text))
    expect(masked).toContain('keep **bold**')
    expect(masked).toContain(sentinels.open.ins.repeat(3))
    expect(masked).toContain(sentinels.close.ins.repeat(3))
    expect(masked).not.toContain('{++')
    expect(masked).not.toContain('++}')
  })

  it('neutralizes sub/comment spans wholesale', () => {
    const text = 'a {~~`tick`~>**bold**~~} {>>comment **text**<<} b'
    const { masked } = maskSource(text, scan(text))
    expect(masked).not.toContain('`tick`')
    expect(masked).not.toContain('**bold**')
    expect(masked).not.toContain('comment **text**')
    expect(masked.startsWith('a ')).toBe(true)
    expect(masked.endsWith(' b')).toBe(true)
  })

  it('keeps newlines and blockquote prefixes inside neutralized spans', () => {
    const text = '> quoted {>>note across\n> more lines<<} end'
    const { masked } = maskSource(text, scan(text))
    const lines = masked.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]!.startsWith('> ')).toBe(true)
    expect(masked).not.toContain('note across')
  })

  it('does not split surrogate pairs', () => {
    const text = '{>>emoji 😀 inside<<}'
    const { masked } = maskSource(text, scan(text))
    expect(masked.length).toBe(text.length)
    // well-formed check: no lone surrogates
    expect(() => encodeURIComponent(masked)).not.toThrow()
  })

  it('falls back to an alternate sentinel pool on collision', () => {
    const dirty = `uses ${String.fromCharCode(0xe000)}${String.fromCharCode(0xe001)} already {++mark++}`
    const { masked, sentinels } = maskSource(dirty, scan(dirty))
    expect(masked).toContain(String.fromCharCode(0xe000) + String.fromCharCode(0xe001))
    for (const sentinel of [...Object.values(sentinels.open), ...Object.values(sentinels.close), ...sentinels.neutral]) {
      expect(dirty).not.toContain(sentinel)
    }
  })

  it('alternates neutral chars so adjacent atoms stay distinguishable', () => {
    const text = '{>>one<<}{>>two<<}'
    const { masked, sentinels } = maskSource(text, scan(text))
    expect(masked).toContain(sentinels.neutral[0])
    expect(masked).toContain(sentinels.neutral[1])
  })

  it('finds sentinels anywhere in the Private Use Area that the source leaves free', () => {
    let crowded = ''
    for (const base of [0xe000, 0xe010, 0xe020, 0xe030, 0xe040]) crowded += String.fromCharCode(base)
    const text = `# Notes ${crowded}\n\nHello {++world++}\n`
    const sentinels = pickSentinels(text)!
    const chosen = [...Object.values(sentinels.open), ...Object.values(sentinels.close), ...sentinels.neutral]
    expect(new Set(chosen).size).toBe(8)
    for (const sentinel of chosen) expect(text).not.toContain(sentinel)
    expect(analyzeMarkdown(text).spans).toHaveLength(1)
  })

  it('reads the source as plain Markdown when fewer than eight Private Use code points are free', () => {
    let everything = ''
    for (let code = 0xe000; code <= 0xf8ff; code++) everything += String.fromCharCode(code)
    expect(pickSentinels(everything)).toBeNull()
    expect(() => maskSource(everything, [])).toThrow()
    const source = `${everything.slice(0, -7)}\n\nHello {++world++}\n`
    const analysis = analyzeMarkdown(source)
    expect(analysis.spans).toEqual([])
    expect(analysis.tree).toBe(analysis.plain)
    expect(analyzeMarkdown(`${everything.slice(0, -8)}\n\nHello {++world++}\n`).spans).toHaveLength(1)
  })
})
