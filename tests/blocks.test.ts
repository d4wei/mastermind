import { describe, expect, it } from 'vitest'
import { segmentBlocks } from '../document/blocks'

const DOC = [
  '# Title',
  '',
  'First paragraph with {++an insertion++}.',
  '',
  '- item one',
  '- item two {>>@ke: note<<}',
  '',
  '```js',
  'code()',
  '```',
  '',
  '> a quote',
].join('\n')

describe('segmentBlocks', () => {
  it('splits headings, paragraphs, list items, code, quotes', () => {
    const blocks = segmentBlocks(DOC)
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'listItem', 'listItem', 'code', 'blockquote'])
    expect(blocks[2]!.text).toBe('- item one')
    expect(blocks.find((b) => b.kind === 'code')!.translatable).toBe(false)
  })

  it('preserves raw CRLF block slices and excludes only literal blocks from translation', () => {
    const source = '---\r\ntitle: Name\r\n---\r\n\r\nParagraph.\r\n\r\n<!-- context -->'
    const blocks = segmentBlocks(source)
    expect(blocks.map(({ kind, translatable }) => [kind, translatable])).toEqual([
      ['yaml', false], ['paragraph', true], ['html', false],
    ])
    for (const block of blocks) expect(source.slice(block.start, block.end)).toBe(block.text)
    expect(blocks[0]!.text).toBe('---\r\ntitle: Name\r\n---')
  })
})


it('keeps separators and link definitions literal and nested lists within their parent item', () => {
  const source = '***\n\n[ref]: https://example.com\n\n- outer\n  - inner\n- next'
  const blocks = segmentBlocks(source)
  expect(blocks.map(({ kind, translatable }) => [kind, translatable])).toEqual([
    ['thematicBreak', false], ['definition', false], ['listItem', true], ['listItem', true],
  ])
  expect(blocks.map((block) => block.text)).toEqual([
    '***', '[ref]: https://example.com', '- outer\n  - inner', '- next',
  ])
  for (const block of blocks) expect(source.slice(block.start, block.end)).toBe(block.text)
})
