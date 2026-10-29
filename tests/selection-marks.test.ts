import { describe, expect, it } from 'vitest'
import type { SelRange } from '../ui/modes/reading/selection'
import { changeVerdict, commentBodyFits, commentEdits, commentVerdict, changeEdits, replyEdits } from '../ui/modes/reading/marks'
import { applyTextEdits } from '../document/edits'
import { scan, group } from '../document/critic/scanner'
import { scanMarkdown } from '../document/markdown/scan'
import { analyzeMarkdown } from '../document/markdown/analyze'

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
    const analysis = analyzeMarkdown(source)
    expect(scanMarkdown(applyTextEdits(source, [{ from: 0, to: 3, insert: '{--```--}' }]))).toHaveLength(analysis.spans.length + 1)
    expect(changeEdits(source, fence, [''], analysis)).toBeNull()
    expect(changeEdits(source, fence, [''])).toBeNull()
  })
})

describe('Markdown structure around new marks', () => {
  const SHORTCUT = '[foo] bar\n\n[foo]: /url'
  const LABEL: SelRange[] = [{ from: 1, to: 3, text: 'fo' }]

  it('refuses a comment or suggestion inside a reference label, which would unlink it', () => {
    expect(commentVerdict(SHORTCUT, LABEL, 'me', 'x')).toEqual({ refused: 'formatting' })
    expect(changeVerdict(SHORTCUT, LABEL, [''])).toEqual({ refused: 'formatting' })
    expect(changeVerdict(SHORTCUT, LABEL, ['ba'])).toEqual({ refused: 'formatting' })
    expect(scanMarkdown(applyTextEdits(SHORTCUT, [{ from: 1, to: 3, insert: '{--fo--}' }]))).toHaveLength(1)
  })

  it('accepts the same marks around the whole reference', () => {
    const whole: SelRange[] = [{ from: 0, to: 5, text: '[foo]' }]
    expect(commentVerdict(SHORTCUT, whole, 'me', 'x')).toEqual({ edits: [{ from: 0, to: 5, insert: '{==[foo]==}{>>@me: x<<}' }] })
    expect(changeVerdict(SHORTCUT, whole, [''])).toEqual({ edits: [{ from: 0, to: 5, insert: '{--[foo]--}' }] })
  })

  it('refuses a highlight that would end the emphasis it holds, but not a substitution of it', () => {
    const source = 'x _a_ y'
    const ranges: SelRange[] = [{ from: 0, to: 5, text: 'x _a_' }]
    expect(commentVerdict(source, ranges, 'me', 'x')).toEqual({ refused: 'formatting' })
    expect(changeVerdict(source, ranges, [''])).toEqual({ refused: 'formatting' })
    expect(changeVerdict(source, ranges, ['z'])).toEqual({ edits: [{ from: 0, to: 5, insert: '{~~x _a_~>z~~}' }] })
  })
})

describe('comment bodies and discussions', () => {
  const HELLO: SelRange[] = [{ from: 0, to: 5, text: 'Hello' }]

  it('refuses a new comment that would join a point comment beside the selection', () => {
    const source = 'Ship it Friday{>>@agent: is Friday firm?<<} please.\n'
    const friday: SelRange[] = [{ from: 8, to: 14, text: 'Friday' }]
    expect(commentEdits(source, friday, 'me', 'prefer Monday', analyzeMarkdown(source))).toBeNull()
    expect(commentEdits(source, friday, 'me', 'prefer Monday')).toBeNull()
    expect(commentEdits(source, [{ from: 0, to: 4, text: 'Ship' }], 'me', 'ok')).not.toBeNull()
  })

  it('collapses runs of whitespace-only lines in a comment body', () => {
    expect(commentBodyFits('me', 'a\n  \n  \nb')).toBe(true)
    expect(commentEdits('Hello world.\n', HELLO, 'me', 'a\n  \n  \nb'))
      .toEqual([{ from: 0, to: 5, insert: '{==Hello==}{>>@me: a\nb<<}' }])
  })

  it.each(['see:\n- one', 'see:\n# heading', 'see:\n> quote', 'see:\n```'])(
    'reports a body line that opens block syntax: %j', (body) => {
      expect(commentBodyFits('me', body)).toBe(false)
      expect(commentEdits('Hello world.\n', HELLO, 'me', body)).toBeNull()
    },
  )
})
