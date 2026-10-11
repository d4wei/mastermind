import { describe, expect, it } from 'vitest'
import { segmentBlocks } from '../src/shared/blocks'

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
  it('splits headings, paragraphs, list items, code, quotes', async () => {
    const blocks = await segmentBlocks(DOC)
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
