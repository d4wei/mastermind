import type { Text } from 'mdast'
import { decodeString } from 'micromark-util-decode-string'
import { visit } from 'unist-util-visit'
import { describe, expect, it } from 'vitest'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { parseMarkdown } from '../document/markdown/processor'
import { alignText, sliceRuns, sourceEndAt, sourceStartAt, type TextRun } from '../document/markdown/provenance'

/** Each run as `value <- source`, for readable expectations. */
function described(source: string, value: string, runs: readonly TextRun[]): string[] {
  return runs.map((run) => `${value.slice(run.valueStart, run.valueEnd)} <- ${source.slice(run.sourceStart, run.sourceEnd)}`)
}

function textRuns(source: string): string[][] {
  const out: string[][] = []
  visit(parseMarkdown(source), 'text', (node: Text) => {
    const runs = alignText(node.value, source, node.position!.start.offset!, node.position!.end.offset!)
    out.push(runs ? described(source, node.value, runs) : ['unaligned'])
  })
  return out
}

describe('the micromark decoder provenance relies on', () => {
  it('decodes escapes, named, decimal, and hexadecimal references, and leaves unknown names', () => {
    expect(decodeString('\\*')).toBe('*')
    expect(decodeString('&amp;')).toBe('&')
    expect(decodeString('&#169;')).toBe('©')
    expect(decodeString('&#X41;')).toBe('A')
    expect(decodeString('&#128512;')).toBe('😀')
    expect(decodeString('&NotEqualTilde;')).toBe('≂̸')
    expect(decodeString('&foo;')).toBe('&foo;')
    expect(decodeString('\\a')).toBe('\\a')
  })
})

describe('aligning parsed text with its source', () => {
  it.each([
    ['AT&amp;T rocks', [['AT <- AT', '& <- &amp;', 'T rocks <- T rocks']]],
    ['5 \\* 3', [['5  <- 5 ', '* <- \\*', ' 3 <-  3']]],
    ['b\\\\*c', [['b <- b', '\\ <- \\\\', '*c <- *c']]],
    ['x &#128512; y', [['x  <- x ', '😀 <- &#128512;', ' y <-  y']]],
    ['x &foo; y', [['x &foo; y <- x &foo; y']]],
    ['> one\n> two', [['one\n <- one\n', 'two <- two']]],
    ['- one  \r\n  two', [['one <- one'], ['two <- two']]],
    ['one\t\ntwo', [['one <- one', '\ntwo <- \ntwo']]],
    ['see <http://a\\*b&amp;c> now', [['see  <- see '], ['http://a\\*b&amp;c <- http://a\\*b&amp;c'], [' now <-  now']]],
    ['| a \\| b |\n| - |', [['a  <- a ', '| <- \\|', ' b <-  b']]],
  ])('aligns %j', (source, expected) => {
    expect(textRuns(source)).toEqual(expected)
  })

  it('refuses a value the source cannot produce', () => {
    expect(alignText('a&b', 'a&amp;c', 0, 7)).toBeNull()
    expect(alignText('ab', 'a b', 0, 3)).toBeNull()
    expect(alignText('a', 'ab', 0, 2)).toBeNull()
  })

  it('aligns every positioned text node of generated Markdown exactly', () => {
    const atoms = ['a', 'b', ' ', '  ', '\t', '\n', '\r\n', '\\', '\\*', '&amp;', '&lt;', '&#65;', '&#x41;', '&foo;', '&', '*',
      '**', '_', '~~', '> ', '- ', '1. ', '[', ']', '(', ')', '<', '>', '`', '|', 'http://a.b', '[^1]', '\n\n', '    ', 'é', '😀']
    let seed = 7
    const random = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    let aligned = 0
    for (let document = 0; document < 1500; document++) {
      let source = ''
      for (let count = 1 + Math.floor(random() * 20); count > 0; count--) source += atoms[Math.floor(random() * atoms.length)]
      visit(parseMarkdown(source), 'text', (node: Text) => {
        const start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start === undefined || end === undefined) return
        const runs = alignText(node.value, source, start, end)
        expect(runs, JSON.stringify(source)).not.toBeNull()
        for (const run of runs!) {
          const value = node.value.slice(run.valueStart, run.valueEnd)
          const raw = source.slice(run.sourceStart, run.sourceEnd)
          expect(value.length === raw.length ? raw : decodeString(raw)).toBe(value)
        }
        aligned++
      })
    }
    expect(aligned).toBeGreaterThan(2000)
  })
})

describe('reading positions from runs', () => {
  // "AT&T" from "AT&amp;T": the decoded "&" is atomic.
  const runs: TextRun[] = [
    { valueStart: 0, valueEnd: 2, sourceStart: 0, sourceEnd: 2 },
    { valueStart: 2, valueEnd: 3, sourceStart: 2, sourceEnd: 7 },
    { valueStart: 3, valueEnd: 4, sourceStart: 7, sourceEnd: 8 },
  ]

  it('maps selection edges to source, keeping a decoded character whole', () => {
    expect([0, 1, 2, 3, 4].map((at) => sourceStartAt(runs, at))).toEqual([0, 1, 2, 7, 8])
    expect([0, 1, 2, 3, 4].map((at) => sourceEndAt(runs, at))).toEqual([0, 1, 2, 7, 8])
  })

  it('maps a value index inside a multi-unit decoded character to nothing', () => {
    const astral: TextRun[] = [{ valueStart: 0, valueEnd: 2, sourceStart: 0, sourceEnd: 9 }]
    expect(sourceStartAt(astral, 1)).toBeNull()
    expect(sourceEndAt(astral, 1)).toBeNull()
  })

  it('maps the ends of a line-ending gap to either side of the dropped prefix', () => {
    // "one\ntwo" from "one\n> two"
    const quoted: TextRun[] = [
      { valueStart: 0, valueEnd: 4, sourceStart: 0, sourceEnd: 4 },
      { valueStart: 4, valueEnd: 7, sourceStart: 6, sourceEnd: 9 },
    ]
    expect(sourceEndAt(quoted, 4)).toBe(4)
    expect(sourceStartAt(quoted, 4)).toBe(6)
  })

  it('slices runs for part of a value and refuses to cut an atomic run', () => {
    expect(sliceRuns(runs, 1, 4)).toEqual([
      { valueStart: 0, valueEnd: 1, sourceStart: 1, sourceEnd: 2 },
      { valueStart: 1, valueEnd: 2, sourceStart: 2, sourceEnd: 7 },
      { valueStart: 2, valueEnd: 3, sourceStart: 7, sourceEnd: 8 },
    ])
    expect(sliceRuns([{ valueStart: 0, valueEnd: 2, sourceStart: 0, sourceEnd: 9 }], 1, 2)).toBeNull()
  })

  it('records provenance for the pieces the review transform splits from decoded text', () => {
    const source = '> AT&amp;T {++ins++}\n> tail'
    const { tree, provenance } = analyzeMarkdown(source)
    const pieces: [string, string[]][] = []
    visit(tree, 'text', (node: Text) => {
      pieces.push([node.value, described(source, node.value, provenance.get(node) ?? [])])
    })
    expect(pieces).toEqual([
      ['AT&T ', ['AT <- AT', '& <- &amp;', 'T  <- T ']],
      ['ins', ['ins <- ins']],
      ['\ntail', ['\n <- \n', 'tail <- tail']],
    ])
  })
})
