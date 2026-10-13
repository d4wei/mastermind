// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import * as processor from '../src/shared/markdown/processor'
import { analyzeMarkdown } from '../src/shared/markdown/analyze'
import { applyTextEdits } from '../src/shared/edits'
import { resolveAll } from '../src/shared/critic/resolve'
import { MarkdownView } from '../src/ui/modes/reading/Renderer'
import { markEdits, rangeToSource, rangeToSourceRanges } from '../src/ui/modes/reading/selection'
import { commentEdits, deletionWrap } from '../src/ui/modes/reading/marks'

function render(source: string) {
  const analysis = analyzeMarkdown(source)
  const host = document.createElement('article')
  host.innerHTML = renderToStaticMarkup(<MarkdownView tree={analysis.tree} ctx={{ source }} />)
  return { host, ...analysis }
}

it.each([
  'Alpha **bravo** charlie `delta` echo.',
  'Alpha *bravo **charlie** delta* echo.',
  'Alpha ~~bravo~~ [charlie](https://example.com) echo.',
  'Alpha **bravo &amp; charlie** echo.',
  'Alpha `` padded ` code `` echo.',
])('maps complete formatting in a paragraph to exact source: %s', (paragraph) => {
  const source = `# Selection\r\n\r\n${paragraph}\r\n`
  const { host, spans } = render(source)
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('p')!)
  const mapped = rangeToSourceRanges(range, source, spans)
  const from = source.indexOf(paragraph)
  expect(mapped).toEqual({ ranges: [{ from, to: from + paragraph.length, text: paragraph }] })
  if (!('ranges' in mapped)) throw new Error(mapped.error)
  expect(rangeToSource(range, source, spans)).toEqual(mapped.ranges[0])
  const commented = applyTextEdits(source, commentEdits(mapped.ranges, 'Alex', 'Review this.'))
  const next = render(commented)
  expect(next.items).toMatchObject([{ type: 'thread', comments: [{ author: 'Alex', body: 'Review this.' }] }])
  expect(next.host.querySelector('p')!.textContent).toBe(host.querySelector('p')!.textContent)
  const deletion = applyTextEdits(source, markEdits(mapped.ranges, deletionWrap))
  const deletionSpans = analyzeMarkdown(deletion).spans
  expect(deletionSpans).toHaveLength(1)
  expect(resolveAll(deletion, deletionSpans, 'reject')).toBe(source)
  expect(resolveAll(deletion, deletionSpans, 'accept')).toBe('# Selection\r\n\r\n\r\n')
})

it('includes complete formatting at both endpoint boundaries without broadening the selected prose', () => {
  const source = 'Before **bold** and *italic* after.'
  const { host } = render(source)
  const range = document.createRange()
  range.setStart(host.querySelector('strong span')!.firstChild!, 0)
  range.setEnd(host.querySelector('em span')!.firstChild!, 6)
  expect(rangeToSourceRanges(range, source, [])).toEqual({ ranges: [{
    from: 7, to: 28, text: '**bold** and *italic*',
  }] })
})

it.each(['start', 'end'])('refuses a selection crossing a partial formatting wrapper at its %s', (edge) => {
  const source = 'Before **bold** after.'
  const { host } = render(source)
  const range = document.createRange()
  const bold = host.querySelector('strong span')!.firstChild!
  const first = host.querySelector('p > span')!.firstChild!
  const last = host.querySelector('p > span:last-child')!.firstChild!
  range.setStart(edge === 'start' ? bold : first, edge === 'start' ? 2 : 0)
  range.setEnd(edge === 'end' ? bold : last, edge === 'end' ? 2 : last.textContent!.length)
  expect(rangeToSourceRanges(range, source, [])).toEqual({ error: 'unmapped' })
  expect(rangeToSource(range, source, [])).toEqual({ error: 'unmapped' })
})

it('keeps selections confined to formatted text and refuses partial inline code crossing', () => {
  const source = 'Before **bravo** and `delta` after.'
  const { host } = render(source)
  const range = document.createRange()
  const bold = host.querySelector('strong span')!.firstChild!
  range.setStart(bold, 1)
  range.setEnd(bold, 4)
  expect(rangeToSourceRanges(range, source, [])).toEqual({ ranges: [{ from: 10, to: 13, text: 'rav' }] })
  range.setStart(host.querySelector('p > span')!.firstChild!, 0)
  range.setEnd(host.querySelector('code')!.firstChild!, 2)
  expect(rangeToSourceRanges(range, source, [])).toEqual({ error: 'unmapped' })
})

it('refuses hidden syntax gaps not accounted for by complete positioned wrappers', () => {
  const source = '**bold** [reference][target] after.\n\n[target]: https://example.com'
  const { host } = render(source)
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('p')!)
  expect(rangeToSourceRanges(range, source, [])).toEqual({ error: 'unmapped' })
})

it('does not nest new marks into formatted selections containing an existing review mark', () => {
  const source = 'Before **bold** {==already==}{>>note<<} after.'
  const { host, spans } = render(source)
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('p')!)
  expect(rangeToSourceRanges(range, source, spans)).toEqual({ error: 'unmapped' })
})

it('retains unique-substring mapping within one formatted text leaf containing an entity', () => {
  const source = '**bravo &amp; charlie**'
  const { host } = render(source)
  const leaf = host.querySelector('strong span')!.firstChild!
  const range = document.createRange()
  range.setStart(leaf, 0)
  range.setEnd(leaf, 5)
  expect(rangeToSourceRanges(range, source, [])).toEqual({ ranges: [{ from: 2, to: 7, text: 'bravo' }] })
  expect(rangeToSource(range, source, [])).toEqual({ from: 2, to: 7, text: 'bravo' })
})

it('does not use the substring fallback across a partial wrapper containing an entity', () => {
  const source = 'Before **bravo &amp; charlie** after.'
  const { host } = render(source)
  const range = document.createRange()
  range.setStart(host.querySelector('strong span')!.firstChild!, 1)
  range.setEnd(host.querySelector('p > span:last-child')!.firstChild!, 6)
  expect(rangeToSourceRanges(range, source, [])).toEqual({ error: 'unmapped' })
  expect(rangeToSource(range, source, [])).toEqual({ error: 'unmapped' })
})

it('parses once per multi-block mapping operation and does not cache across operations', () => {
  const source = 'First **bold** paragraph.\n\nSecond *italic* paragraph.'
  const { host } = render(source)
  const paragraphs = host.querySelectorAll('p')
  const range = document.createRange()
  range.setStart(paragraphs[0]!, 0)
  range.setEnd(paragraphs[1]!, paragraphs[1]!.childNodes.length)
  const parse = vi.spyOn(processor, 'parseMarkdown')
  try {
    expect(rangeToSourceRanges(range, source, [])).toEqual({ ranges: [
      { from: 0, to: 25, text: 'First **bold** paragraph.' },
      { from: 27, to: source.length, text: 'Second *italic* paragraph.' },
    ] })
    expect(parse).toHaveBeenCalledTimes(1)
    rangeToSourceRanges(range, source, [])
    expect(parse).toHaveBeenCalledTimes(2)
  } finally {
    parse.mockRestore()
  }
})
