import { describe, expect, it } from 'vitest'
import type { SelRange } from '../ui/modes/reading/selection'
import { commentEdits, changeEdits, replyEdits } from '../ui/modes/reading/marks'
import { applyTextEdits } from '../document/edits'
import { scan, group } from '../document/critic/scanner'
import { scanMarkdown } from '../document/markdown/scan'

const SOURCE = 'First paragraph.\n\nSecond paragraph.'
// A realistic cross-block selection: from "paragraph." in block 0 through
// "Second paragraph" in block 1 (block 0: start→end, block 1: start→end point).
const CROSS: SelRange[] = [
  { from: 6, to: 16, text: 'paragraph.' },
  { from: 18, to: 34, text: 'Second paragraph' },
]

describe('cross-block marks round-trip', () => {
  it('substitutes within each block independently', () => {
    const out = applyTextEdits(SOURCE, changeEdits(SOURCE, CROSS, ['section.', 'Third section'])!)
    expect(out).toBe('First {~~paragraph.~>section.~~}\n\n{~~Second paragraph~>Third section~~}.')
    const subs = scan(out).filter((s) => s.kind === 'sub')
    expect(subs).toHaveLength(2)
    expect(subs.map((s) => out.slice(s.oldStart, s.oldEnd))).toEqual(['paragraph.', 'Second paragraph'])
  })

  it('suggests deletion on each block', () => {
    const out = applyTextEdits(SOURCE, changeEdits(SOURCE, CROSS, ['', ''])!)
    expect(out).toBe('First {--paragraph.--}\n\n{--Second paragraph--}.')
    expect(scan(out).filter((s) => s.kind === 'del')).toHaveLength(2)
  })

  it('attaches a comment to the first block and leaves later source unchanged', () => {
    const out = applyTextEdits(
      SOURCE,
      commentEdits(SOURCE, CROSS, 'Alex', 'needs detail')!,
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
    expect(applyTextEdits(SOURCE, commentEdits(SOURCE, one, 'Alex', 'why')!))
      .toBe('First {==paragraph==}{>>@Alex: why<<}.\n\nSecond paragraph.')
    expect(applyTextEdits(SOURCE, changeEdits(SOURCE, one, [''])!)).toBe('First {--paragraph--}.\n\nSecond paragraph.')
  })
})

it('changes selected fragments independently and leaves their source gaps intact', () => {
  const edits = changeEdits(SOURCE, CROSS, ['section.', ''])!
  const out = applyTextEdits(SOURCE, edits)
  expect(out).toBe('First {~~paragraph.~>section.~~}\n\n{--Second paragraph--}.')
  expect(scan(out).map((span) => span.kind)).toEqual(['sub', 'del'])
  expect(changeEdits(SOURCE, CROSS, CROSS.map((range) => range.text))).toEqual([])
})

it.each(['new\n\nparagraph', 'new~~} escape', '{++nested++}'])(
  'rejects unrepresentable replacement text without changing it: %s', (replacement) => {
    expect(changeEdits(SOURCE, [CROSS[0]!], [replacement])).toBeNull()
  },
)

it('preserves replacement Markdown and Chinese text byte for byte', () => {
  const replacement = '**新的内容**，包括 `code`。'
  expect(changeEdits(SOURCE, [CROSS[0]!], [replacement])).toEqual([
    { from: 6, to: 16, insert: `{~~paragraph.~>${replacement}~~}` },
  ])
})

describe('marks verified in the edited source', () => {
  // The backslash escapes the selected backtick until a mark's opener separates them.
  const ESCAPED = 'Say \\` once, then ` again.'
  const TICK: SelRange[] = [{ from: 5, to: 11, text: '` once' }]

  it('refuses a comment or a deletion whose selected backtick would pair once spliced', () => {
    expect(scanMarkdown('{==` once==}{>>@Alex: hi<<}')).toHaveLength(2)
    expect(scanMarkdown(applyTextEdits(ESCAPED, [{ ...TICK[0]!, insert: '{==` once==}{>>@Alex: hi<<}' }])))
      .toHaveLength(0)
    expect(commentEdits(ESCAPED, TICK, 'Alex', 'hi')).toBeNull()
    expect(changeEdits(ESCAPED, TICK, [''])).toBeNull()
    expect(changeEdits(ESCAPED, TICK, ['` twice'])).toBeNull()
  })

  it('refuses a comment or reply whose body backtick would pair with one after it', () => {
    const source = 'Run it, then `code` here.'
    const run: SelRange[] = [{ from: 0, to: 3, text: 'Run' }]
    expect(commentEdits(source, run, 'Alex', 'use `x')).toBeNull()
    const commented = applyTextEdits(source, commentEdits(source, run, 'Alex', 'fine')!)
    const thread = scan(commented)[1]!
    expect(replyEdits(commented, thread.end, 'Sam', 'use `x')).toBeNull()
    expect(applyTextEdits(commented, replyEdits(commented, thread.end, 'Sam', 'agreed')!))
      .toBe('{==Run==}{>>@Alex: fine<<}{>>@Sam: agreed<<} it, then `code` here.')
  })

  it('accepts marks beside existing marks without disturbing them', () => {
    const source = 'Keep {++this++} and that.'
    const that: SelRange[] = [{ from: 20, to: 24, text: 'that' }]
    const out = applyTextEdits(source, changeEdits(source, that, ['those'])!)
    expect(out).toBe('Keep {++this++} and {~~that~>those~~}.')
    expect(scan(out).map((span) => span.kind)).toEqual(['ins', 'sub'])
  })

  it('refuses an edit that trades one existing mark for another while the count holds', () => {
    // Unfencing the first line releases the fenced mark and lets the last fence swallow the next one.
    const source = '```\n{++a++}\n```\n{++b++}\n'
    const fence: SelRange[] = [{ from: 0, to: 3, text: '```' }]
    const spans = scanMarkdown(source)
    expect(scanMarkdown(applyTextEdits(source, [{ from: 0, to: 3, insert: '{--```--}' }]))).toHaveLength(spans.length + 1)
    expect(changeEdits(source, fence, [''], spans)).toBeNull()
    expect(changeEdits(source, fence, [''])).toBeNull()
  })
})
