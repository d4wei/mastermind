// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { readingMatches, commentRange, revealMatch } from '../ui/find/reading'
import { textMatches } from '../ui/find/matches'
import { commentSearchText } from '../ui/review/CommentBody'

it('matches across inline formatting while respecting blocks, cells, chrome, and hidden archives', () => {
  const root = document.createElement('article')
  root.innerHTML = '<h1>Review <em>this</em> document</h1><p>Review</p><p>this</p>' +
    '<table><tr><th>status</th><td>Review</td></tr></table><pre>Review\nthis</pre>' +
    '<button>Review this</button><div hidden>Review this</div><div class="print-footnotes">Review this</div>' +
    '<p><a href="/Review-this">Read</a> <span aria-hidden="true">Review this</span></p>'
  const matches = readingMatches(root, 'review this', false)
  expect(matches).toHaveLength(1)
  expect(matches[0]!.range.toString()).toBe('Review this')
  expect(readingMatches(root, 'Review', true)).toHaveLength(4)
  expect(readingMatches(root, '/Review-this', true)).toHaveLength(0)
  expect(readingMatches(root, 'statusReview', true)).toHaveLength(0)
  expect(readingMatches(root, 'Review\nthis', true)).toHaveLength(1)
})

it('uses literal matching with correct Unicode offsets and preserves whitespace in queries', () => {
  expect(textMatches('评审评审', '评审', false)).toEqual([{ from: 0, to: 2 }, { from: 2, to: 4 }])
  expect(textMatches('a.b aXb', 'a.b', false)).toEqual([{ from: 0, to: 3 }])
  expect(textMatches('a\\nb a\nb', '\\n', false)).toEqual([{ from: 1, to: 3 }])
  expect(textMatches('x x', ' ', false)).toEqual([{ from: 1, to: 2 }])
  expect(textMatches('İ Review', 'review', false)).toEqual([{ from: 2, to: 8 }])
  expect(textMatches('anything', '', false)).toEqual([])
})

it('maps collapsed display whitespace back to exact DOM ranges without changing nodes', () => {
  const root = document.createElement('article')
  root.innerHTML = '<p>A  <strong> useful\nexample</strong></p>'
  const original = root.innerHTML
  const matches = readingMatches(root, 'A useful example', false)
  expect(matches).toHaveLength(1)
  expect(matches[0]!.range.toString()).toBe('A   useful\nexample')
  expect(root.innerHTML).toBe(original)
})

it('uses comment display text rather than hard-wrapped source lines', () => {
  expect(commentSearchText('A useful\nexample')).toBe('A useful example')
  const root = document.createElement('div')
  root.textContent = commentSearchText('评审\n这个例子')
  const match = textMatches(root.textContent, '评审 这个', false)[0]!
  expect(commentRange(root, match)?.toString()).toBe('评审 这个')
})

it('keeps a result clear of an overlapping floating panel without moving already-visible results', () => {
  const scroller = document.createElement('div'); scroller.className = 'document-scroll'
  const p = document.createElement('p'); p.textContent = 'result'; scroller.append(p)
  const range = document.createRange(); range.selectNodeContents(p)
  const panel = document.createElement('div')
  scroller.getBoundingClientRect = () => ({ top: 40, bottom: 600 } as DOMRect)
  panel.getBoundingClientRect = () => ({ left: 500, right: 900, bottom: 110 } as DOMRect)
  range.getBoundingClientRect = () => ({ left: 550, right: 600, top: 80, bottom: 100 } as DOMRect)
  scroller.scrollTop = 200
  revealMatch(range, panel); expect(scroller.scrollTop).toBe(158)
  range.getBoundingClientRect = () => ({ left: 550, right: 600, top: 200, bottom: 220 } as DOMRect)
  revealMatch(range, panel); expect(scroller.scrollTop).toBe(158)
})

it('updates registered highlight membership and removes every old range on close', async () => {
  const { vi } = await import('vitest')
  const { paintMatches, clearMatches } = await import('../ui/find/reading')
  const registry = new Map<string, Set<Range>>()
  vi.stubGlobal('CSS', { highlights: registry })
  vi.stubGlobal('Highlight', class extends Set<Range> { constructor(...ranges: Range[]) { super(ranges) } })
  try {
    const root = document.createElement('p'); root.textContent = 'review another review'
    const first = readingMatches(root, 'review', false)
    paintMatches(first.map((match) => match.range), first[0]!.range)
    const registered = registry.get('find-results')!
    const next = readingMatches(root, 'another', false)
    paintMatches(next.map((match) => match.range), next[0]!.range)
    expect(registry.get('find-results')).toBe(registered)
    expect([...registered].map((range) => range.toString())).toEqual(['another'])
    expect([...registry.get('find-current')!][0]).not.toBe(next[0]!.range)
    clearMatches()
    expect(registered.size).toBe(0)
    expect(registry.size).toBe(0)
  } finally { vi.unstubAllGlobals() }
})

it('reveals a match in an offscreen table column without changing the document scroll position', () => {
  const scroller = document.createElement('div'); scroller.className = 'document-scroll'
  const tableScroll = document.createElement('div'); tableScroll.className = 'md-table-scroll'
  const cell = document.createElement('span'); cell.textContent = 'Fallback'
  scroller.append(tableScroll); tableScroll.append(cell)
  const range = document.createRange(); range.selectNodeContents(cell)
  scroller.getBoundingClientRect = () => ({ top: 40, bottom: 600 } as DOMRect)
  tableScroll.getBoundingClientRect = () => ({ left: 100, right: 700 } as DOMRect)
  range.getBoundingClientRect = () => ({ left: 850, right: 950, top: 200, bottom: 220 } as DOMRect)
  scroller.scrollTop = 200
  revealMatch(range, null)
  expect(tableScroll.scrollLeft).toBe(250)
  expect(scroller.scrollTop).toBe(200)
  range.getBoundingClientRect = () => ({ left: 50, right: 150, top: 200, bottom: 220 } as DOMRect)
  revealMatch(range, null)
  expect(tableScroll.scrollLeft).toBe(200)
})
