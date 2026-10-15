import { expect, it } from 'vitest'
import { parseMarkdown } from '../document/markdown/processor'
import { extractOutline } from '../ui/modes/reading/outline'

it.each(['\n', '\r\n'])('measures consecutive heading sections through document end with %j', (eol) => {
  const prefix = ['---', 'title: Example', '---', '', ''].join(eol)
  const first = ['# First', '', 'Short introduction.', '', ''].join(eol)
  const second = ['### Nested', '', '> ## Quoted heading', '', '```md', '# Code heading', '```', '', ''].join(eol)
  const last = ['## Last', '', 'The last section has no following heading.', ''].join(eol)
  expect(extractOutline(parseMarkdown(prefix + first + second + last))).toEqual([
    { depth: 1, text: 'First', offset: prefix.length, sectionLength: first.length },
    { depth: 3, text: 'Nested', offset: prefix.length + first.length, sectionLength: second.length },
    { depth: 2, text: 'Last', offset: prefix.length + first.length + second.length, sectionLength: last.length },
  ])
})

it('has no section indicators when the document has no headings', () => {
  expect(extractOutline(parseMarkdown('Plain text.'))).toEqual([])
})
