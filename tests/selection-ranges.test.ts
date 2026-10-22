// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, expect, it } from 'vitest'
import { rangeBetween } from './helpers/dom'
import { renderMarkdown } from './helpers/markdown'
import { applyTextEdits } from '../document/edits'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { rangeToSourceRanges } from '../ui/modes/reading/selection'
import { commentEdits } from '../ui/modes/reading/marks'

// Mirrors the renderer's output: each block carries data-ps/data-pe and wraps its
// text in a span with matching data-ps/data-pe, so pointToOffset's length-equality
// fast path applies.
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


describe('rangeToSourceRanges', () => {
  it('single-block selection yields one range', () => {
    const { t0 } = build()
    const res = rangeToSourceRanges(rangeBetween(t0, 6, t0, 15), SOURCE, [])
    expect('ranges' in res && res.ranges).toEqual([{ from: 6, to: 15, text: 'paragraph' }])
  })

  it('cross-block selection yields one range per block (start→end, start→end point)', () => {
    const { t0, t1 } = build()
    // from "paragraph." in block 0 through "Second paragraph" in block 1
    const res = rangeToSourceRanges(rangeBetween(t0, 6, t1, 16), SOURCE, [])
    if (!('ranges' in res)) throw new Error(`expected ranges, got ${res.error}`)
    expect(res.ranges).toEqual([
      { from: 6, to: 16, text: 'paragraph.' },
      { from: 18, to: 34, text: 'Second paragraph' },
    ])
    // the slices are exactly what the source says — never a guess
    for (const r of res.ranges) expect(SOURCE.slice(r.from, r.to)).toBe(r.text)
  })

  it('hides (errors) only when nothing in the selection is markable', () => {
    const { t0 } = build()
    // a single-block selection sitting entirely inside an existing mark
    const res = rangeToSourceRanges(rangeBetween(t0, 6, t0, 15), SOURCE, [
      { kind: 'highlight', start: 4, end: 16, innerStart: 6, innerEnd: 15 },
    ])
    expect(res).toEqual({ error: 'unmapped' })
  })

  it('empty / collapsed selection is rejected', () => {
    const { t0 } = build()
    expect(rangeToSourceRanges(rangeBetween(t0, 6, t0, 6), SOURCE, [])).toEqual({ error: 'empty' })
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
  it.each(['Alpha {++beta++} gamma', 'Alpha{>>c<<} gamma', 'Alpha {~~a~>b~~} gamma'])(
    'maps the text on either side of the mark: %s', (source) => {
      const { host, spans } = renderMarkdown(source)
      const before = source.slice(0, source.indexOf('{'))
      const after = source.slice(source.lastIndexOf('}') + 1)
      expect(rangeToSourceRanges(contents(host.querySelector('p')!), source, spans)).toEqual({ ranges: [
        { from: 0, to: before.length, text: before },
        { from: source.length - after.length, to: source.length, text: after },
      ] })
    },
  )

  it('keeps the block containing a mark when the selection continues into the next block', () => {
    const source = 'Alpha {++beta++} gamma\n\nSecond paragraph.'
    const { host, spans } = renderMarkdown(source)
    const range = rangeBetween(textOf(host, 'p > span'), 0, textOf(host, 'p > span', 2), 6)
    expect(rangeToSourceRanges(range, source, spans)).toEqual({ ranges: [
      { from: 0, to: 6, text: 'Alpha ' },
      { from: 16, to: 22, text: ' gamma' },
      { from: 24, to: 30, text: 'Second' },
    ] })
  })

  it('drops whitespace-only pieces between adjacent marks', () => {
    const source = 'Alpha {++beta++} {--delta--} gamma'
    const { host, spans } = renderMarkdown(source)
    const mapped = rangeToSourceRanges(contents(host.querySelector('p')!), source, spans)
    expect(mapped).toEqual({ ranges: [{ from: 0, to: 6, text: 'Alpha ' }, { from: 28, to: 34, text: ' gamma' }] })
  })

  it('maps text beside a mark by exact offsets where the substring fallback would refuse', () => {
    // The entity changes the paragraph's rendered length, and both pieces recur inside the mark.
    const source = 'Alpha {++beta *Alpha &amp; gamma*++} gamma'
    const { host, spans } = renderMarkdown(source)
    expect(rangeToSourceRanges(contents(host.querySelector('p')!), source, spans)).toEqual({ ranges: [
      { from: 0, to: 6, text: 'Alpha ' },
      { from: 36, to: 42, text: ' gamma' },
    ] })
  })

  it('refuses a selection entirely inside an insertion', () => {
    const source = 'Alpha {++beta++} gamma'
    const { host, spans } = renderMarkdown(source)
    const inserted = host.querySelector('ins')!.firstChild!.firstChild as Text
    expect(rangeToSourceRanges(rangeBetween(inserted, 1, inserted, 3), source, spans)).toEqual({ error: 'unmapped' })
  })
})

describe('selections across nested list items', () => {
  it('maps the parent text when a selection enters a nested item', () => {
    const source = '- parent item\n  - child item'
    const { host } = renderMarkdown(source)
    const range = rangeBetween(textOf(host, 'li > span'), 0, textOf(host, 'li li > span'), 5)
    expect(rangeToSourceRanges(range, source, [])).toEqual({ ranges: [
      { from: 2, to: 13, text: 'parent item' },
      { from: 18, to: 23, text: 'child' },
    ] })
  })

  it('keeps an outer item\'s own text when the selection continues past its nested list', () => {
    const source = '- one\n  - one.a\n- two'
    const { host } = renderMarkdown(source)
    const range = rangeBetween(textOf(host, 'li > span'), 0, textOf(host, 'li > span', 2), 3)
    expect(rangeToSourceRanges(range, source, [])).toEqual({ ranges: [
      { from: 2, to: 5, text: 'one' },
      { from: 10, to: 15, text: 'one.a' },
      { from: 18, to: 21, text: 'two' },
    ] })
  })
})

describe('substring fallback for leaves whose rendered length differs from source', () => {
  it.each([
    ['AT&amp;T and AT&T', 'AT&T'],
    ['5 \\* 3 and 5 * 3', '5 * 3'],
    ['- a\\*b\n  - a*b', 'a*b'],
  ])('refuses an occurrence it cannot tell apart: %s', (source, selected) => {
    const { host } = renderMarkdown(source)
    const leaf = textOf(host, 'p > span, li > span')
    expect(leaf.data.startsWith(selected)).toBe(true)
    expect(rangeToSourceRanges(rangeBetween(leaf, 0, leaf, selected.length), source, [])).toEqual({ error: 'unmapped' })
  })

  it('maps text that occurs once in both the rendered leaf and its source', () => {
    const source = 'AT&amp;T rocks'
    const { host } = renderMarkdown(source)
    const leaf = textOf(host, 'p > span')
    expect(rangeToSourceRanges(rangeBetween(leaf, 0, leaf, 2), source, [])).toEqual({ ranges: [{ from: 0, to: 2, text: 'AT' }] })
    expect(rangeToSourceRanges(rangeBetween(leaf, 5, leaf, 10), source, [])).toEqual({ ranges: [{ from: 9, to: 14, text: 'rocks' }] })
  })
})

describe('comment round trip', () => {
  it('refuses a comment whose selected text would close the new highlight early', () => {
    const source = 'Type a ==} here.'
    const { host, spans } = renderMarkdown(source)
    const leaf = textOf(host, 'p > span')
    const mapped = rangeToSourceRanges(rangeBetween(leaf, 5, leaf, 10), source, spans)
    if (!('ranges' in mapped)) throw new Error(mapped.error)
    expect(mapped.ranges).toEqual([{ from: 5, to: 10, text: 'a ==}' }])
    expect(commentEdits(mapped.ranges, 'me', 'hi')).toBeNull()
  })

  it('anchors a comment on ordinary selected text', () => {
    const source = 'Type a ==} here.'
    const { host, spans } = renderMarkdown(source)
    const leaf = textOf(host, 'p > span')
    const mapped = rangeToSourceRanges(rangeBetween(leaf, 0, leaf, 4), source, spans)
    if (!('ranges' in mapped)) throw new Error(mapped.error)
    const updated = applyTextEdits(source, commentEdits(mapped.ranges, 'me', 'hi')!)
    expect(updated).toBe('{==Type==}{>>@me: hi<<} a ==} here.')
    expect(analyzeMarkdown(updated).items).toMatchObject([
      { type: 'thread', anchor: { start: 0, end: 10 }, comments: [{ author: 'me', body: 'hi' }] },
    ])
  })
})
