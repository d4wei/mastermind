// @vitest-environment jsdom
import { renderMarkdown } from './helpers/markdown'
import { expect, it, vi } from 'vitest'
import * as processor from '../document/markdown/processor'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { applyTextEdits } from '../document/edits'
import { resolveAll } from '../document/critic/resolve'
import { mapSelection, type SelRange, type SelectionMapping } from '../ui/modes/reading/selection'
import { changeEdits, commentEdits } from '../ui/modes/reading/marks'

function segments(mapping: SelectionMapping): SelRange[] {
  if (mapping.status !== 'covered') throw new Error(`expected coverage, got ${mapping.status}`)
  return mapping.segments
}


it.each([
  'Alpha **bravo** charlie `delta` echo.',
  'Alpha *bravo **charlie** delta* echo.',
  'Alpha ~~bravo~~ [charlie](https://example.com) echo.',
  'Alpha **bravo &amp; charlie** echo.',
  'Alpha `` padded ` code `` echo.',
])('maps complete formatting in a paragraph to exact source: %s', (paragraph) => {
  const source = `# Selection\r\n\r\n${paragraph}\r\n`
  const rendered = renderMarkdown(source)
  const { host } = rendered
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('p')!)
  const mapped = segments(mapSelection(range, source, rendered))
  const from = source.indexOf(paragraph)
  expect(mapped).toEqual([{ from, to: from + paragraph.length, text: paragraph }])
  const commented = applyTextEdits(source, commentEdits(source, mapped, 'Alex', 'Review this.')!)
  const next = renderMarkdown(commented)
  expect(next.items).toMatchObject([{ type: 'thread', comments: [{ author: 'Alex', body: 'Review this.' }] }])
  expect(next.host.querySelector('p')!.textContent).toBe(host.querySelector('p')!.textContent)
  const deletion = applyTextEdits(source, changeEdits(source, mapped, mapped.map(() => ''))!)
  const deletionSpans = analyzeMarkdown(deletion).spans
  expect(deletionSpans).toHaveLength(1)
  expect(resolveAll(deletion, deletionSpans, 'reject')).toBe(source)
  expect(resolveAll(deletion, deletionSpans, 'accept')).toBe('# Selection\r\n\r\n\r\n')
})

it('includes complete formatting at both endpoint boundaries without broadening the selected prose', () => {
  const source = 'Before **bold** and *italic* after.'
  const { host } = renderMarkdown(source)
  const range = document.createRange()
  range.setStart(host.querySelector('strong span')!.firstChild!, 0)
  range.setEnd(host.querySelector('em span')!.firstChild!, 6)
  expect(segments(mapSelection(range, source, analyzeMarkdown(source)))).toEqual([{
    from: 7, to: 28, text: '**bold** and *italic*',
  }])
})

it.each([
  ['start', [{ from: 11, to: 13, text: 'ld' }, { from: 15, to: 22, text: ' after.' }]],
  ['end', [{ from: 0, to: 7, text: 'Before ' }, { from: 9, to: 11, text: 'bo' }]],
])('splits a selection crossing a partial formatting wrapper at its %s, keeping its syntax intact', (edge, expected) => {
  const source = 'Before **bold** after.'
  const { host } = renderMarkdown(source)
  const range = document.createRange()
  const bold = host.querySelector('strong span')!.firstChild!
  const first = host.querySelector('p > span')!.firstChild!
  const last = host.querySelector('p > span:last-child')!.firstChild!
  range.setStart(edge === 'start' ? bold : first, edge === 'start' ? 2 : 0)
  range.setEnd(edge === 'end' ? bold : last, edge === 'end' ? 2 : last.textContent!.length)
  const mapped = segments(mapSelection(range, source, analyzeMarkdown(source)))
  expect(mapped).toEqual(expected)
  const deletion = applyTextEdits(source, changeEdits(source, mapped, mapped.map(() => ''))!)
  expect(deletion).toBe(edge === 'start' ? 'Before **bo{--ld--}**{-- after.--}' : '{--Before --}**{--bo--}ld** after.')
  const spans = analyzeMarkdown(deletion).spans
  expect(resolveAll(deletion, spans, 'reject')).toBe(source)
  expect(resolveAll(deletion, spans, 'accept')).toBe(edge === 'start' ? 'Before **bo**' : '**ld** after.')
})

it('keeps selections confined to formatted text and explains a partial inline code crossing', () => {
  const source = 'Before **bravo** and `delta` after.'
  const { host } = renderMarkdown(source)
  const range = document.createRange()
  const bold = host.querySelector('strong span')!.firstChild!
  range.setStart(bold, 1)
  range.setEnd(bold, 4)
  expect(segments(mapSelection(range, source, analyzeMarkdown(source)))).toEqual([{ from: 10, to: 13, text: 'rav' }])
  range.setStart(host.querySelector('p > span')!.firstChild!, 0)
  range.setEnd(host.querySelector('code')!.firstChild!, 2)
  expect(mapSelection(range, source, analyzeMarkdown(source))).toMatchObject({
    segments: [{ from: 0, to: 21, text: 'Before **bravo** and ' }], excluded: [{ text: 'de', reason: 'partial-code' }],
  })
})

it('maps a complete reference link with its label and reference syntax', () => {
  const source = '**bold** [reference][target] after.\n\n[target]: https://example.com'
  const { host } = renderMarkdown(source)
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('p')!)
  expect(segments(mapSelection(range, source, analyzeMarkdown(source))))
    .toEqual([{ from: 0, to: 35, text: '**bold** [reference][target] after.' }])
})

it('maps the exact pieces on both sides of an existing review mark in formatted text', () => {
  const source = 'Before **bold** {==already==}{>>note<<} after.'
  const rendered = renderMarkdown(source)
  const { host } = rendered
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('p')!)
  expect(mapSelection(range, source, rendered)).toMatchObject({ segments: [
    { from: 0, to: 16, text: 'Before **bold** ' },
    { from: 39, to: 46, text: ' after.' },
  ], excluded: [{ text: 'already', reason: 'existing-mark' }] })
})

it('maps within one formatted text leaf containing an entity by position', () => {
  const source = '**bravo &amp; charlie**'
  const { host } = renderMarkdown(source)
  const leaf = host.querySelector('strong span')!.firstChild!
  const range = document.createRange()
  range.setStart(leaf, 0)
  range.setEnd(leaf, 5)
  expect(segments(mapSelection(range, source, analyzeMarkdown(source)))).toEqual([{ from: 2, to: 7, text: 'bravo' }])
})

it('splits a partial wrapper containing an entity at the wrapper, keeping the entity whole', () => {
  const source = 'Before **bravo &amp; charlie** after.'
  const { host } = renderMarkdown(source)
  const range = document.createRange()
  range.setStart(host.querySelector('strong span')!.firstChild!, 1)
  range.setEnd(host.querySelector('p > span:last-child')!.firstChild!, 6)
  expect(segments(mapSelection(range, source, analyzeMarkdown(source)))).toEqual([
    { from: 10, to: 28, text: 'ravo &amp; charlie' },
    { from: 30, to: 36, text: ' after' },
  ])
})

it('maps a multi-block selection from the analysis without parsing', () => {
  const source = 'First **bold** paragraph.\n\nSecond *italic* paragraph.'
  const rendered = renderMarkdown(source)
  const paragraphs = rendered.host.querySelectorAll('p')
  const range = document.createRange()
  range.setStart(paragraphs[0]!, 0)
  range.setEnd(paragraphs[1]!, paragraphs[1]!.childNodes.length)
  const parse = vi.spyOn(processor, 'parseMarkdown')
  try {
    expect(segments(mapSelection(range, source, rendered))).toEqual([
      { from: 0, to: 25, text: 'First **bold** paragraph.' },
      { from: 27, to: source.length, text: 'Second *italic* paragraph.' },
    ])
    expect(parse).not.toHaveBeenCalled()
    analyzeMarkdown(source)
    expect(parse).toHaveBeenCalled()
  } finally {
    parse.mockRestore()
  }
})
