// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { renderMarkdown } from './helpers/markdown'
import { applyTextEdits } from '../document/edits'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { resolveAll } from '../document/critic/resolve'
import { commentEdits, changeEdits } from '../ui/modes/reading/marks'
import { mapSelection } from '../ui/modes/reading/selection'

it('maps a selection across a hard-wrapped task-list continuation', () => {
  const source = '- [ ] **Check.** Compare the available plans for new\n  readers before choosing a default.'
  const rendered = renderMarkdown(source)
  const walker = document.createTreeWalker(rendered.host, NodeFilter.SHOW_TEXT)
  let leaf: Node | null
  while ((leaf = walker.nextNode())) {
    if (leaf.textContent?.includes('Compare')) break
  }
  if (!leaf) throw new Error('Missing prose leaf')
  const text = leaf.textContent!
  const range = document.createRange()
  range.setStart(leaf, text.indexOf('available'))
  range.setEnd(leaf, text.indexOf(' before'))
  const from = source.indexOf('available')
  const to = source.indexOf(' before')
  expect(mapSelection(range, source, rendered)).toMatchObject({ segments: [{ from, to, text: source.slice(from, to) }], excluded: [] })
})

it.each(['\n', '\r\n', '\r'])('maps repeated single characters by position after a continuation (%j)', (newline) => {
  const source = `- [ ] **Check.** Read every entry.${newline}  Read every entry again.`
  const rendered = renderMarkdown(source)
  const leaf = [...rendered.host.querySelectorAll('span')].find(el => el.textContent?.includes('again'))!.firstChild!
  const value = leaf.textContent!
  const offset = value.lastIndexOf('Read')
  const range = document.createRange()
  range.setStart(leaf, offset); range.setEnd(leaf, offset + 1)
  const from = source.lastIndexOf('Read')
  expect(mapSelection(range, source, rendered)).toMatchObject({ segments: [{ from, to: from + 1, text: 'R' }] })
})

it.each([
  '- [ ] **Check.** Compare plans for new\n  readers before choosing.',
  '> Compare plans for new\n> readers before choosing.',
  '> - Compare plans for new\n>   readers before choosing.',
  '- Compare plans for new\r\n  readers before choosing.',
])('round-trips comments and suggested deletions across container continuations: %s', (source) => {
  const rendered = renderMarkdown(source)
  const leaf = [...rendered.host.querySelectorAll('span')].find(el => el.textContent?.includes('Compare'))!.firstChild!
  const value = leaf.textContent!
  const range = document.createRange()
  range.setStart(leaf, value.indexOf('plans')); range.setEnd(leaf, value.indexOf(' before'))
  const mapped = mapSelection(range, source, rendered)
  if (mapped.status !== 'covered') throw new Error(mapped.status)
  const from = source.indexOf('plans'); const to = source.indexOf(' before')
  expect(mapped.segments).toEqual([{ from, to, text: source.slice(from, to) }])
  const comments = commentEdits(source, mapped.segments, 'Alex', 'Check this.')
  expect(comments).not.toBeNull()
  const commented = renderMarkdown(applyTextEdits(source, comments!))
  expect(commented.items).toMatchObject([{ type: 'thread', comments: [{ author: 'Alex', body: 'Check this.' }] }])
  const changes = changeEdits(source, mapped.segments, [''])
  expect(changes).not.toBeNull()
  const changed = applyTextEdits(source, changes!)
  const spans = analyzeMarkdown(changed).spans
  expect(resolveAll(changed, spans, 'reject')).toBe(source)
  expect(resolveAll(changed, spans, 'accept')).toBe(source.slice(0, from) + source.slice(to))
})

it('maps complete formatting beside a wrapped text leaf without losing indentation', () => {
  const source = '- **Compare** plans for new\n  readers before choosing.'
  const rendered = renderMarkdown(source)
  const range = document.createRange()
  range.selectNodeContents(rendered.host.querySelector('li')!)
  expect(mapSelection(range, source, rendered)).toMatchObject({ segments: [
    { from: 2, to: source.length, text: source.slice(2) },
  ] })
})
