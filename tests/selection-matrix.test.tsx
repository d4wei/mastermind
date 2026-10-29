// @vitest-environment jsdom
// The selection fixture matrix: real Markdown through the shipped renderer, rendered by the React
// client as in the app, selected through the document selection in both directions and with text
// or element endpoints. Each case states the source slices the selection maps to and the reasons for
// any selected text left out; every mapped case then round-trips a comment and suggestions through
// the file.
import { act, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inputValue } from './helpers/dom'
import { renderMarkdown } from './helpers/markdown'
import { DRIVES, selectRendered } from './helpers/selection'
import { applyTextEdits } from '../document/edits'
import { acceptEdit, rejectEdit } from '../document/critic/resolve'
import type { CriticSpan } from '../document/critic/types'
import type { TextEdit } from '../document/types'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { mapSelection, type ExclusionReason, type SelRange } from '../ui/modes/reading/selection'
import { changeVerdict, commentVerdict } from '../ui/modes/reading/marks'
import { MarkdownView } from '../ui/modes/reading/Renderer'
import { SelectionToolbar } from '../ui/modes/reading/SelectionToolbar'

/** A source slice by its text and, when it recurs, the occurrence meant. */
type Slice = string | [text: string, occurrence: number]

interface Case {
  source: string
  /** Rendered text to select, and its occurrence when it recurs. */
  select: Slice
  segments: Slice[]
  excluded?: ExclusionReason[]
  /** Why a comment on the segments is refused, when it is. */
  comment?: 'markup' | 'formatting'
  /** Why a suggested deletion of the segments is refused, when it is. */
  deletion?: 'formatting'
}

function slice(source: string, expected: Slice): SelRange {
  const [text, occurrence] = typeof expected === 'string' ? [expected, 0] : expected
  let from = -1
  for (let index = 0; index <= occurrence; index++) {
    from = source.indexOf(text, from + 1)
    if (from === -1) throw new Error(`Source has no occurrence ${occurrence} of ${JSON.stringify(text)}`)
  }
  return { from, to: from + text.length, text }
}

const CASES: Record<string, Case> = {
  'plain prose': { source: 'Alpha bravo charlie.', select: 'bravo', segments: ['bravo'] },
  'repeated text by position': { source: 'the cat and the hat', select: ['the', 1], segments: [['the', 1]] },
  'partial bold at its start': { source: 'Before **bold** after.', select: 're bo', segments: ['re ', 'bo'] },
  'partial bold at its end': { source: 'Before **bold** after.', select: 'ld aft', segments: ['ld', ' aft'] },
  'complete bold inside the selection': {
    source: 'Before **bold** after.', select: 'fore bold af', segments: ['fore **bold** af'],
  },
  'complete strong nested in partial emphasis': {
    source: 'Alpha *bravo **charlie** delta* echo.', select: 'vo charlie del', segments: ['vo **charlie** del'],
  },
  'partial emphasis and partial nested strong': {
    source: 'Alpha *bravo **charlie** delta* echo.', select: 'ha bravo char', segments: ['ha ', 'bravo ', 'char'],
  },
  'complete and partial wrappers together': {
    source: 'Before **bold** and *italic* after.', select: 'fore bold and ita',
    segments: ['fore **bold** and ', 'ita'],
  },
  'partial strikethrough': { source: 'Keep ~~struck text~~ here.', select: 'ep struck', segments: ['ep ', 'struck'] },
  'partial link text': { source: 'See [the docs](https://x.y) now.', select: 'e the d', segments: ['e ', 'the d'] },
  'complete link': {
    source: 'See [the docs](https://x.y "T") now.', select: 'ee the docs no', segments: ['ee [the docs](https://x.y "T") no'],
  },
  'named entity': { source: 'AT&amp;T and AT&T', select: ['AT&T', 0], segments: ['AT&amp;T'] },
  'literal text matching a decoded entity': { source: 'AT&amp;T and AT&T', select: ['AT&T', 1], segments: [['AT&T', 0]] },
  'part of a decoded entity run': { source: 'AT&amp;T rocks', select: '&T r', segments: ['&amp;T r'] },
  'less-than and numeric references': {
    source: 'Use &lt;tag&gt; and &#169; 2024.', select: '<tag> and ©', segments: ['&lt;tag&gt; and &#169;'],
  },
  'backslash escape': { source: '5 \\* 3 and 5 * 3', select: ['5 * 3', 0], segments: ['5 \\* 3'] },
  'the literal twin of an escape': { source: '5 \\* 3 and 5 * 3', select: ['5 * 3', 1], segments: [['5 * 3', 0]] },
  'an escaped character alone': { source: '5 \\* 3', select: '*', segments: ['\\*'] },
  'complete full reference link': {
    source: '**bold** [reference][target] after.\n\n[target]: https://example.com',
    select: 'bold reference after.', segments: ['**bold** [reference][target] after.'],
  },
  'partial full reference link': {
    source: 'A [reference][target] after.\n\n[target]: https://example.com',
    select: 'eference af', segments: ['eference', ' af'],
  },
  'complete shortcut reference': { source: '[foo] bar\n\n[foo]: /url', select: 'foo bar', segments: ['[foo] bar'] },
  'partial shortcut reference label': {
    source: '[foo] bar\n\n[foo]: /url', select: 'oo b', segments: [' b'], excluded: ['partial-link'],
  },
  'partial angle autolink': {
    source: 'see <https://x.y/p> now', select: 'x.y', segments: [], excluded: ['partial-link'],
  },
  'complete angle autolink': { source: 'see <https://x.y/p> now', select: 'see https://x.y/p now', segments: ['see <https://x.y/p> now'] },
  'complete literal autolink': { source: 'see https://x.y now', select: 'e https://x.y n', segments: ['e https://x.y n'] },
  'hard break with trailing spaces': { source: 'line one  \nline two', select: 'oneline', segments: ['one  \nline'] },
  'hard break with a backslash': { source: 'line one\\\nline two', select: 'oneline', segments: ['one\\\nline'] },
  'soft break': { source: 'line one\nline two', select: 'one\nline', segments: ['one\nline'] },
  'soft break with CRLF': { source: 'line one\r\nline two\r\n', select: 'one\r\nline', segments: ['one\r\nline'] },
  'soft break with a lone CR': { source: 'line one\rline two', select: 'e\rl', segments: ['e\rl'] },
  'blockquote continuation': { source: '> one two\n> three four', select: 'two\nthree', segments: ['two\n> three'] },
  'list continuation with CRLF': {
    source: '- Compare plans for new\r\n  readers before.', select: 'new\r\nreaders', segments: ['new\r\n  readers'],
  },
  'list items and a nested list': {
    source: '- one\n- two\n  - nested', select: 'onetwonest', segments: ['one', 'two', 'nest'],
  },
  'container text before its nested list': {
    source: '- parent item\n  - child item', select: 'itemchild', segments: [['item', 0], 'child'],
  },
  'heading with partial bold': { source: '# Head **bold** line', select: 'ad bo', segments: ['ad ', 'bo'] },
  'table cells': {
    source: '| a | b |\n| - | - |\n| cell one | cell two |', select: 'onecell', segments: ['one', ['cell', 1]],
  },
  'complete footnote reference': { source: 'Text[^1] more.\n\n[^1]: Note body.', select: 'xt[1] mo', segments: ['xt[^1] mo'] },
  'partial footnote reference label': {
    source: 'Text[^1] more.\n\n[^1]: Note body.', select: 'Text[1', segments: ['Text'], excluded: ['generated-text'],
  },
  'footnote definition label': {
    source: 'Text[^1] more.\n\n[^1]: Note body.', select: ['[1] Note', 0], segments: ['Note'], excluded: ['generated-text'],
  },
  'complete image': { source: 'See ![alt](x.png) here.', select: 'See  here', segments: ['See ![alt](x.png) here'] },
  'complete image reference': {
    source: 'See ![alt][r] here.\n\n[r]: x.png', select: 'ee [image: alt] he', segments: ['ee ![alt][r] he'],
  },
  'partial image reference label': {
    source: 'See ![alt][r] here.\n\n[r]: x.png', select: 'See [im', segments: ['See '], excluded: ['generated-text'],
  },
  'across an insertion': {
    source: 'Alpha {++beta++} gamma', select: 'Alpha beta gamma', segments: ['Alpha ', ' gamma'], excluded: ['existing-mark'],
  },
  'inside an insertion': { source: 'Alpha {++beta++} gamma', select: 'et', segments: [], excluded: ['existing-mark'] },
  'across a substitution': {
    source: 'Alpha {~~a~>b~~} gamma', select: 'Alpha a→b gamma', segments: ['Alpha ', ' gamma'], excluded: ['existing-mark'],
  },
  'across a standalone highlight': {
    source: 'a {==b==} c', select: 'a b c', segments: ['a ', ' c'], excluded: ['existing-mark'],
  },
  // A comment on the first segment would join the point comment after it, not start a discussion.
  'across a comment marker': {
    source: 'Alpha{>>c<<} gamma', select: 'Alpha gamma', segments: ['Alpha', ' gamma'], comment: 'markup',
  },
  'across an anchored discussion in formatted text': {
    source: 'Before **bold** {==already==}{>>note<<} after.', select: 'Before bold already after.',
    segments: ['Before **bold** ', ' after.'], excluded: ['existing-mark'],
  },
  'fenced code': { source: '```sh\ncommand\n```', select: 'command', segments: [], excluded: ['opaque-block'] },
  'indented code': { source: 'Para.\n\n    code line', select: 'code', segments: [], excluded: ['opaque-block'] },
  'prose across fenced code': {
    source: 'Before.\n\n```\ncode\n```\n\nAfter.', select: 'Before.codeAfter', segments: ['Before.', 'After'],
    excluded: ['opaque-block'],
  },
  'complete inline code': { source: 'Try `open` now.', select: 'open', segments: ['`open`'] },
  'partial inline code': { source: 'Try `open` now.', select: 'pe', segments: [], excluded: ['partial-code'] },
  'prose into partial inline code': {
    source: 'Try `open` now.', select: 'Try op', segments: ['Try '], excluded: ['partial-code'],
  },
  'raw HTML block': { source: '<div>raw</div>\n\nText.', select: 'raw', segments: [], excluded: ['opaque-block'] },
  'complete inline HTML': { source: 'a <b>bold</b> c', select: 'a <b>bold</b> c', segments: ['a <b>bold</b> c'] },
  'frontmatter into the body': {
    source: '---\ntitle: x\n---\n\nBody text.', select: 'xBody', segments: ['Body'], excluded: ['opaque-block'],
  },
  'CRLF document with partial formatting': {
    source: '# Title\r\n\r\nAlpha **bravo** charlie.\r\n', select: 'ha bravo ch', segments: ['ha **bravo** ch'],
  },
  'byte order mark': { source: '﻿Hello world.', select: 'world', segments: ['world'] },
  // The masked reading parse sees a sentinel, not punctuation, beside the underscore, so a highlight
  // or deletion would end the emphasis it holds. A substitution shows its old text verbatim, so only
  // the Markdown around it must keep its structure.
  'a mark that would end emphasis in the reading view': {
    source: 'x _a_ y', select: 'x a', segments: ['x _a_'], comment: 'formatting', deletion: 'formatting',
  },
}

const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  window.getSelection()?.removeAllRanges()
  vi.unstubAllGlobals()
})

function rendered(source: string) {
  const analysis = analyzeMarkdown(source)
  const host = document.createElement('article')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(<MarkdownView analysis={analysis} ctx={{ source }} />))
  cleanups.push(() => { act(() => root.unmount()); host.remove() })
  return { host, ...analysis }
}

/** The spans an edit added, found where its inserts landed. */
function addedSpans(updated: string, edits: readonly TextEdit[]): CriticSpan[] {
  const inserted: [number, number][] = []
  let shift = 0
  for (const edit of [...edits].sort((a, b) => a.from - b.from)) {
    inserted.push([edit.from + shift, edit.from + shift + edit.insert.length])
    shift += edit.insert.length - (edit.to - edit.from)
  }
  return analyzeMarkdown(updated).spans.filter((span) => inserted.some(([from, to]) => span.start >= from && span.start < to))
}

function resolved(updated: string, spans: readonly CriticSpan[], resolve: typeof acceptEdit): string {
  return applyTextEdits(updated, spans.map((span) => resolve(updated, span)))
}

describe.each(Object.entries(CASES))('%s', (_name, { source, select, segments, excluded = [], comment, deletion }) => {
  const expected = segments.map((segment) => slice(source, segment))
  const [needle, occurrence] = typeof select === 'string' ? [select, 0] : select

  it.each(DRIVES)('maps the selection with %s', (_drive, drive) => {
    const analysis = rendered(source)
    const range = selectRendered(analysis.host, needle, occurrence, drive)
    const mapped = mapSelection(range, source, analysis, analysis.host)
    expect(mapped).toMatchObject({ status: 'covered', revision: source, quote: range.toString() })
    if (mapped.status !== 'covered') return
    expect(mapped.segments).toEqual(expected)
    expect(mapped.excluded.map((segment) => segment.reason)).toEqual(excluded)
    for (const segment of mapped.excluded) expect(range.toString()).toContain(segment.text.trim())
  })

  if (!expected.length) return
  const analysis = analyzeMarkdown(source)

  it('anchors a comment on the first segment that resolves back to the original bytes', () => {
    const verdict = commentVerdict(source, expected, 'Alex', 'Check this.', analysis)
    if (comment) return expect(verdict).toEqual({ refused: comment })
    if (!('edits' in verdict)) throw new Error(`comment refused: ${verdict.refused}`)
    const updated = applyTextEdits(source, verdict.edits)
    const added = addedSpans(updated, verdict.edits)
    expect(added.map((span) => span.kind)).toEqual(['highlight', 'comment'])
    expect(updated.slice(added[0]!.innerStart, added[0]!.innerEnd)).toBe(expected[0]!.text)
    const after = analyzeMarkdown(updated)
    expect(after.threads).toHaveLength(analysis.threads.length + 1)
    expect(resolved(updated, added, rejectEdit)).toBe(source)
    expect(resolved(updated, added, acceptEdit)).toBe(source)
  })

  it('suggests deleting the segments; rejection restores and acceptance removes exactly them', () => {
    const verdict = changeVerdict(source, expected, expected.map(() => ''), analysis)
    if (deletion) return expect(verdict).toEqual({ refused: deletion })
    if (!('edits' in verdict)) throw new Error(`deletion refused: ${verdict.refused}`)
    const updated = applyTextEdits(source, verdict.edits)
    const added = addedSpans(updated, verdict.edits)
    expect(added.map((span) => span.kind)).toEqual(expected.map(() => 'del'))
    expect(resolved(updated, added, rejectEdit)).toBe(source)
    expect(resolved(updated, added, acceptEdit))
      .toBe(applyTextEdits(source, expected.map(({ from, to }) => ({ from, to, insert: '' }))))
  })

  it('suggests replacing the segments; acceptance substitutes exactly them', () => {
    const verdict = changeVerdict(source, expected, expected.map(() => 'X'), analysis)
    if (!('edits' in verdict)) throw new Error(`substitution refused: ${verdict.refused}`)
    const updated = applyTextEdits(source, verdict.edits)
    const added = addedSpans(updated, verdict.edits)
    expect(added.map((span) => span.kind)).toEqual(expected.map(() => 'sub'))
    expect(resolved(updated, added, rejectEdit)).toBe(source)
    expect(resolved(updated, added, acceptEdit))
      .toBe(applyTextEdits(source, expected.map(({ from, to }) => ({ from, to, insert: 'X' }))))
  })
})

it('maps a leaf whose rendered line endings an HTML parse normalized', () => {
  const source = '- Compare plans for new\r\n  readers before.'
  const analysis = renderMarkdown(source)
  document.body.append(analysis.host)
  cleanups.push(() => analysis.host.remove())
  const range = selectRendered(analysis.host, 'new\nreaders')
  expect(mapSelection(range, source, analysis, analysis.host)).toMatchObject({ segments: [slice(source, 'new\r\n  readers')] })
})

describe('inactivity and races', () => {
  it('is inactive for a collapsed, whitespace-only, or outside selection', () => {
    const source = 'Alpha  bravo.'
    const analysis = rendered(source)
    const text = analysis.host.querySelector('span')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 2)
    expect(mapSelection(range, source, analysis, analysis.host)).toEqual({ status: 'inactive' })
    range.setStart(text, 5)
    range.setEnd(text, 7)
    expect(mapSelection(range, source, analysis, analysis.host)).toEqual({ status: 'inactive' })
    const outside = document.createElement('p')
    outside.textContent = 'Elsewhere'
    document.body.append(outside)
    cleanups.push(() => outside.remove())
    const elsewhere = document.createRange()
    elsewhere.selectNodeContents(outside)
    expect(mapSelection(elsewhere, source, analysis, analysis.host)).toEqual({ status: 'inactive' })
  })

  it('reports a DOM rendered from another revision as outdated, not as a mapping failure', () => {
    const before = rendered('Alpha bravo.')
    const range = selectRendered(before.host, 'bravo')
    const after = analyzeMarkdown('Alpha bravo charlie.')
    expect(mapSelection(range, 'Alpha bravo charlie.', after, before.host)).toEqual({ status: 'outdated' })
    const shifted = analyzeMarkdown('Intro.\n\nAlpha bravo.')
    expect(mapSelection(range, 'Intro.\n\nAlpha bravo.', shifted, before.host)).toEqual({ status: 'outdated' })
  })

  it('maps the latest of several rapid reselections independently of the earlier ones', () => {
    const source = 'One two three.'
    const analysis = rendered(source)
    const first = selectRendered(analysis.host, 'One').cloneRange()
    const latest = selectRendered(analysis.host, 'three')
    expect(mapSelection(latest, source, analysis, analysis.host)).toMatchObject({ segments: [slice(source, 'three')] })
    expect(mapSelection(first, source, analysis, analysis.host)).toMatchObject({ segments: [slice(source, 'One')] })
  })
})

describe('the selection toolbar', () => {
  const edit = vi.fn((_edits: TextEdit[]) => true)
  let host: HTMLElement
  let root: ReturnType<typeof createRoot>

  /** `rendered` is the source the article shows; it lags `source` to stand in for a render in flight. */
  function Review({ source, rendered = source }: { source: string; rendered?: string }) {
    const ref = useRef<HTMLElement>(null)
    const shown = useMemo(() => analyzeMarkdown(rendered), [rendered])
    const analysis = useMemo(() => analyzeMarkdown(source), [source])
    return <><article ref={ref}><MarkdownView analysis={shown} ctx={{ source: rendered }} /></article>
      <SelectionToolbar containerRef={ref} source={source} analysis={analysis} authorTag="Alex" onEdit={edit} /></>
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    edit.mockClear()
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true, value: () => ({ top: 100, left: 100, width: 40 }),
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    cleanups.push(() => {
      act(() => root.unmount())
      host.remove()
      Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
      vi.useRealTimers()
    })
  })

  async function show(source: string, needle: string, occurrence = 0, rendered = source): Promise<void> {
    act(() => root.render(<Review source={source} rendered={rendered} />))
    selectRendered(host.querySelector('article')!, needle, occurrence)
    act(() => document.dispatchEvent(new Event('selectionchange')))
    await act(async () => vi.advanceTimersByTimeAsync(120))
  }

  const buttons = (): string[] => Array.from(host.querySelectorAll('.sel-toolbar > button'), (button) => button.textContent!)
  const note = (): string | undefined => host.querySelector('.sel-note')?.textContent ?? undefined
  const press = (label: string): void => act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('.sel-toolbar button'))
    .find((button) => button.textContent === label)!.click())

  it('explains a selection that maps nothing instead of hiding', async () => {
    await show('```sh\ncommand\n```', 'command')
    expect(buttons()).toEqual([])
    expect(note()).toBe('Code blocks, HTML, and metadata cannot take inline suggestions.')
  })

  it('keeps both actions for a partial mapping and states what is left out', async () => {
    await show('Try `open` now.', 'Try op')
    expect(buttons()).toEqual(['Comment', 'Suggest change'])
    expect(note()).toBe('Only part of this selection can be marked. Inline code is reviewed as a whole. Select all of it.')
    press('Suggest change')
    expect(host.querySelector('textarea')!.value).toBe('Try ')
    expect(note()).toBe('Only part of this selection can be marked. Inline code is reviewed as a whole. Select all of it.')
  })

  it('says a comment attaches to the first part of a split selection', async () => {
    await show('Before **bold** after.', 're bo')
    expect(note()).toBeUndefined()
    press('Comment')
    expect(host.querySelector('.sel-composer')!.textContent).toContain('The comment attaches to the first selected part.')
    act(() => inputValue(host.querySelector('textarea')!, 'Why?'))
    press('Comment')
    expect(edit).toHaveBeenCalledWith([{ from: 4, to: 7, insert: '{==re ==}{>>@Alex: Why?<<}' }])
  })

  it('names a mark that would change the surrounding formatting', async () => {
    await show('x _a_ y', 'x a')
    press('Suggest change')
    act(() => inputValue(host.querySelector('textarea')!, ''))
    expect(host.querySelector('[role="alert"]')!.textContent)
      .toBe('A mark here would change how the surrounding Markdown displays. Adjust the selection.')
    expect(host.querySelector<HTMLButtonElement>('.btn-primary')!.disabled).toBe(true)
  })

  it('re-reads a selection whose source changed before it, mapping it into the new revision', async () => {
    await show('Intro.\n\nAlpha bravo.', 'bravo')
    act(() => root.render(<Review source={'Intro changed.\n\nAlpha bravo.'} />))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(note()).toBeUndefined()
    press('Suggest change')
    act(() => inputValue(host.querySelector('textarea')!, ''))
    press('Suggest change')
    expect(edit).toHaveBeenCalledWith([{ from: 22, to: 27, insert: '{--bravo--}' }])
  })

  it('waits for the render of a new source rather than reporting the selection unmatched', async () => {
    await show('Alpha bravo.', 'bravo')
    act(() => root.render(<Review source={'Alpha bravo charlie.'} rendered={'Alpha bravo.'} />))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(buttons()).toEqual(['Comment', 'Suggest change'])
    expect(note()).toBeUndefined()
  })

  it('acts on the latest of rapid reselections', async () => {
    await show('One two three.', 'One')
    selectRendered(host.querySelector('article')!, 'three')
    act(() => document.dispatchEvent(new Event('selectionchange')))
    press('Suggest change')
    expect(host.querySelector('textarea')!.value).toBe('three')
  })
})
