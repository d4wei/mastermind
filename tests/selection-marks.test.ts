import { describe, expect, it } from 'vitest'
import { markEdits, type SelRange } from '../ui/modes/reading/selection'
import { commentEdits, changeEdits } from '../ui/modes/reading/marks'
import { applyTextEdits } from '../document/edits'
import { scan, group } from '../document/critic/scanner'

const SOURCE = 'First paragraph.\n\nSecond paragraph.'
// A realistic cross-block selection: from "paragraph." in block 0 through
// "Second paragraph" in block 1 (block 0: start→end, block 1: start→end point).
const CROSS: SelRange[] = [
  { from: 6, to: 16, text: 'paragraph.' },
  { from: 18, to: 34, text: 'Second paragraph' },
]

describe('markEdits — cross-block marks round-trip', () => {
  it('highlights each block independently', () => {
    const out = applyTextEdits(SOURCE, markEdits(CROSS, (s) => `{==${s}==}`))
    expect(out).toBe('First {==paragraph.==}\n\n{==Second paragraph==}.')
    const highlights = scan(out).filter((s) => s.kind === 'highlight')
    expect(highlights).toHaveLength(2)
    expect(highlights.map((h) => out.slice(h.innerStart, h.innerEnd))).toEqual(['paragraph.', 'Second paragraph'])
  })

  it('suggests deletion on each block', () => {
    const out = applyTextEdits(SOURCE, markEdits(CROSS, (s) => `{--${s}--}`))
    expect(out).toBe('First {--paragraph.--}\n\n{--Second paragraph--}.')
    expect(scan(out).filter((s) => s.kind === 'del')).toHaveLength(2)
  })

  it('attaches a comment to the first block and leaves later source unchanged', () => {
    const out = applyTextEdits(
      SOURCE,
      commentEdits(CROSS, 'Alex', 'needs detail'),
    )
    const items = group(scan(out), out)
    const threads = items.filter((it) => it.type === 'thread')
    const bareHighlights = items.filter((it) => it.type === 'highlight')
    expect(threads).toHaveLength(1)
    expect(bareHighlights).toHaveLength(0)
    expect(out).toBe('First {==paragraph.==}{>>@Alex: needs detail<<}\n\nSecond paragraph.')
    expect(threads[0]).toMatchObject({ type: 'thread' })
    if (threads[0]?.type === 'thread') {
      expect(threads[0].comments[0]?.body).toContain('needs detail')
      expect(threads[0].comments[0]?.author).toBe('Alex')
    }
  })

  it('preserves text outside a single range', () => {
    const one: SelRange[] = [{ from: 6, to: 15, text: 'paragraph' }]
    expect(applyTextEdits(SOURCE, markEdits(one, (s) => `{==${s}==}`))).toBe('First {==paragraph==}.\n\nSecond paragraph.')
  })
})

it('changes selected fragments independently and leaves their source gaps intact', () => {
  const edits = changeEdits(CROSS, ['section.', ''])!
  const out = applyTextEdits(SOURCE, edits)
  expect(out).toBe('First {~~paragraph.~>section.~~}\n\n{--Second paragraph--}.')
  expect(scan(out).map((span) => span.kind)).toEqual(['sub', 'del'])
  expect(changeEdits(CROSS, CROSS.map((range) => range.text))).toEqual([])
})

it.each(['new\n\nparagraph', 'new~~} escape', '{++nested++}'])(
  'rejects unrepresentable replacement text without changing it: %s', (replacement) => {
    expect(changeEdits([CROSS[0]!], [replacement])).toBeNull()
  },
)

it('preserves replacement Markdown and Chinese text byte for byte', () => {
  const replacement = '**新的内容**，包括 `code`。'
  expect(changeEdits([CROSS[0]!], [replacement])).toEqual([
    { from: 6, to: 16, insert: `{~~paragraph.~>${replacement}~~}` },
  ])
})
