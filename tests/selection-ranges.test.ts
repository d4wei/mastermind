// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, expect, it } from 'vitest'
import { rangeBetween } from './helpers/dom'
import { renderMarkdown } from './helpers/markdown'
import { applyTextEdits } from '../document/edits'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { mapSelection, type SelRange, type SelectionMapping } from '../ui/modes/reading/selection'
import { commentEdits } from '../ui/modes/reading/marks'

// Mirrors the renderer's output: each block carries data-ps/data-pe and wraps its text in a leaf span
// with matching data-ps/data-pe.
const SOURCE = 'First paragraph.\n\nSecond paragraph.'

function build(): { root: HTMLElement; t0: Text; t1: Text } {
  document.body.innerHTML = `
    <div class="md-root">
      <p data-ps="0" data-pe="16"><span data-ps="0" data-pe="16">First paragraph.</span></p>
      <p data-ps="18" data-pe="35"><span data-ps="18" data-pe="35">Second paragraph.</span></p>
    </div>`
  const root = document.querySelector('.md-root') as HTMLElement
  const [s0, s1] = Array.from(root.querySelectorAll('span'))
  return { root, t0: s0!.firstChild as Text, t1: s1!.firstChild as Text }
}

function segments(mapping: SelectionMapping): SelRange[] {
  if (mapping.status !== 'covered') throw new Error(`expected coverage, got ${mapping.status}`)
  return mapping.segments
}

describe('mapSelection', () => {
  it('maps a single-block selection to one segment', () => {
    const { t0 } = build()
    expect(mapSelection(rangeBetween(t0, 6, t0, 15), SOURCE, analyzeMarkdown(SOURCE))).toEqual({
      status: 'covered', revision: SOURCE, quote: 'paragraph', segments: [{ from: 6, to: 15, text: 'paragraph' }], excluded: [],
    })
  })

  it('maps a cross-block selection to one segment per block', () => {
    const { t0, t1 } = build()
    const mapped = segments(mapSelection(rangeBetween(t0, 6, t1, 16), SOURCE, analyzeMarkdown(SOURCE)))
    expect(mapped).toEqual([
      { from: 6, to: 16, text: 'paragraph.' },
      { from: 18, to: 34, text: 'Second paragraph' },
    ])
    for (const r of mapped) expect(SOURCE.slice(r.from, r.to)).toBe(r.text)
  })

  it('accounts for text inside an existing mark instead of hiding the selection', () => {
    const { t0 } = build()
    const analysis = { ...analyzeMarkdown(SOURCE), spans: [{ kind: 'highlight' as const, start: 4, end: 16, innerStart: 6, innerEnd: 15 }] }
    expect(mapSelection(rangeBetween(t0, 6, t0, 15), SOURCE, analysis)).toMatchObject({
      status: 'covered', segments: [], excluded: [{ text: 'paragraph', reason: 'existing-mark' }],
    })
  })

  it('treats an empty or collapsed selection as inactive', () => {
    const { t0 } = build()
    expect(mapSelection(rangeBetween(t0, 6, t0, 6), SOURCE, analyzeMarkdown(SOURCE))).toEqual({ status: 'inactive' })
  })
})

function textOf(host: HTMLElement, selector: string, index = 0): Text {
  return host.querySelectorAll(selector)[index]!.firstChild as Text
}

function contents(element: Element): Range {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range
}

describe('selections across rendered review marks', () => {
  it.each([
    ['Alpha {++beta++} gamma', ['existing-mark']],
    ['Alpha{>>c<<} gamma', []],
    ['Alpha {~~a~>b~~} gamma', ['existing-mark']],
  ])('maps the text on either side of the mark: %s', (source, reasons) => {
    const rendered = renderMarkdown(source)
    const before = source.slice(0, source.indexOf('{'))
    const after = source.slice(source.lastIndexOf('}') + 1)
    const mapped = mapSelection(contents(rendered.host.querySelector('p')!), source, rendered)
    expect(mapped).toMatchObject({ segments: [
      { from: 0, to: before.length, text: before },
      { from: source.length - after.length, to: source.length, text: after },
    ] })
    expect(mapped.status === 'covered' && mapped.excluded.map((item) => item.reason)).toEqual(reasons)
  })

  it('keeps the block containing a mark when the selection continues into the next block', () => {
    const source = 'Alpha {++beta++} gamma\n\nSecond paragraph.'
    const rendered = renderMarkdown(source)
    const range = rangeBetween(textOf(rendered.host, 'p > span'), 0, textOf(rendered.host, 'p > span', 2), 6)
    expect(segments(mapSelection(range, source, rendered))).toEqual([
      { from: 0, to: 6, text: 'Alpha ' },
      { from: 16, to: 22, text: ' gamma' },
      { from: 24, to: 30, text: 'Second' },
    ])
  })

  it('drops whitespace-only segments between adjacent marks', () => {
    const source = 'Alpha {++beta++} {--delta--} gamma'
    const rendered = renderMarkdown(source)
    expect(segments(mapSelection(contents(rendered.host.querySelector('p')!), source, rendered)))
      .toEqual([{ from: 0, to: 6, text: 'Alpha ' }, { from: 28, to: 34, text: ' gamma' }])
  })

  it('maps text beside a mark by position when the same text recurs inside it', () => {
    const source = 'Alpha {++beta *Alpha &amp; gamma*++} gamma'
    const rendered = renderMarkdown(source)
    expect(segments(mapSelection(contents(rendered.host.querySelector('p')!), source, rendered))).toEqual([
      { from: 0, to: 6, text: 'Alpha ' },
      { from: 36, to: 42, text: ' gamma' },
    ])
  })

  it('explains a selection entirely inside an insertion', () => {
    const source = 'Alpha {++beta++} gamma'
    const rendered = renderMarkdown(source)
    const inserted = rendered.host.querySelector('ins')!.firstChild!.firstChild as Text
    expect(mapSelection(rangeBetween(inserted, 1, inserted, 3), source, rendered)).toMatchObject({
      status: 'covered', segments: [], excluded: [{ text: 'et', reason: 'existing-mark' }],
    })
  })
})

describe('selections across nested list items', () => {
  it('maps the parent text when a selection enters a nested item', () => {
    const source = '- parent item\n  - child item'
    const rendered = renderMarkdown(source)
    const range = rangeBetween(textOf(rendered.host, 'li > span'), 0, textOf(rendered.host, 'li li > span'), 5)
    expect(segments(mapSelection(range, source, rendered))).toEqual([
      { from: 2, to: 13, text: 'parent item' },
      { from: 18, to: 23, text: 'child' },
    ])
  })

  it('keeps an outer item\'s own text when the selection continues past its nested list', () => {
    const source = '- one\n  - one.a\n- two'
    const rendered = renderMarkdown(source)
    const range = rangeBetween(textOf(rendered.host, 'li > span'), 0, textOf(rendered.host, 'li > span', 2), 3)
    expect(segments(mapSelection(range, source, rendered))).toEqual([
      { from: 2, to: 5, text: 'one' },
      { from: 10, to: 15, text: 'one.a' },
      { from: 18, to: 21, text: 'two' },
    ])
  })
})

describe('decoded text mapped by provenance', () => {
  it.each([
    ['AT&amp;T and AT&T', 'AT&T', 'AT&amp;T'],
    ['5 \\* 3 and 5 * 3', '5 * 3', '5 \\* 3'],
    ['- a\\*b\n  - a*b', 'a*b', 'a\\*b'],
  ])('maps the first of two identical renderings to its own source: %s', (source, selected, expected) => {
    const rendered = renderMarkdown(source)
    const leaf = textOf(rendered.host, 'p > span, li > span')
    expect(leaf.data.startsWith(selected)).toBe(true)
    const from = source.indexOf(expected)
    expect(segments(mapSelection(rangeBetween(leaf, 0, leaf, selected.length), source, rendered)))
      .toEqual([{ from, to: from + expected.length, text: expected }])
  })

  it.each([
    ['\\*x\\*{>>c<<} and *x*', '\\*x\\*'],
    ['Tom &amp; Jerry{>>c<<} and [l](u "Tom & Jerry")', 'Tom &amp; Jerry'],
  ])('maps a decoded piece beside a mark to its own source: %s', (source, expected) => {
    const rendered = renderMarkdown(source)
    const leaf = textOf(rendered.host, 'p > span')
    expect(segments(mapSelection(rangeBetween(leaf, 0, leaf, leaf.length), source, rendered)))
      .toEqual([{ from: 0, to: expected.length, text: expected }])
  })

  it.each([
    ['Write &amp;lt; to get &lt; here.', '&lt', '&amp;lt'],
    ['Price \\$5 or $', '$5', '\\$5'],
  ])('keeps a decoded character whole at a selection edge: %s', (source, selected, expected) => {
    const rendered = renderMarkdown(source)
    const leaf = textOf(rendered.host, 'p > span')
    const at = leaf.data.indexOf(selected)
    const from = source.indexOf(expected)
    expect(segments(mapSelection(rangeBetween(leaf, at, leaf, at + selected.length), source, rendered)))
      .toEqual([{ from, to: from + expected.length, text: expected }])
  })
})

describe('comment round trip', () => {
  it('refuses a comment whose selected text would close the new highlight early', () => {
    const source = 'Type a ==} here.'
    const rendered = renderMarkdown(source)
    const leaf = textOf(rendered.host, 'p > span')
    const mapped = segments(mapSelection(rangeBetween(leaf, 5, leaf, 10), source, rendered))
    expect(mapped).toEqual([{ from: 5, to: 10, text: 'a ==}' }])
    expect(commentEdits(source, mapped, 'me', 'hi')).toBeNull()
  })

  it('anchors a comment on ordinary selected text', () => {
    const source = 'Type a ==} here.'
    const rendered = renderMarkdown(source)
    const leaf = textOf(rendered.host, 'p > span')
    const mapped = segments(mapSelection(rangeBetween(leaf, 0, leaf, 4), source, rendered))
    const updated = applyTextEdits(source, commentEdits(source, mapped, 'me', 'hi')!)
    expect(updated).toBe('{==Type==}{>>@me: hi<<} a ==} here.')
    expect(analyzeMarkdown(updated).items).toMatchObject([
      { type: 'thread', anchor: { start: 0, end: 10 }, comments: [{ author: 'me', body: 'hi' }] },
    ])
  })
})

it('accounts for an image inside an existing mark by its alternative text', () => {
  const source = 'See {++![chart](c.png)++} here.'
  const rendered = renderMarkdown(source)
  expect(mapSelection(contents(rendered.host.querySelector('p')!), source, rendered)).toMatchObject({
    segments: [{ from: 0, to: 4, text: 'See ' }, { from: 25, to: 31, text: ' here.' }],
    excluded: [{ text: 'chart', reason: 'existing-mark' }],
  })
})
