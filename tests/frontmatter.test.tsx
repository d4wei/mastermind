// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { analyzeMarkdown } from '../src/shared/markdown/analyze'
import { parseMarkdown } from '../src/shared/markdown/processor'
import { segmentBlocks } from '../src/shared/blocks'
import { applyTextEdits } from '../src/shared/edits'
import { acceptEdit } from '../src/shared/critic/resolve'
import { MarkdownView } from '../src/ui/modes/reading/Renderer'
import { rangeToSourceRanges } from '../src/ui/modes/reading/selection'

const metadata = '---\ntitle: "{>>literal<<}"\nitems:\n  - one\n  - two\n---'

function render(source: string): HTMLElement {
  const { tree } = analyzeMarkdown(source)
  const root = document.createElement('article')
  root.innerHTML = renderToStaticMarkup(<MarkdownView tree={tree} ctx={{ source }} />)
  return root
}

describe('YAML frontmatter', () => {
  it.each(['\n', '\r\n'])('keeps body offsets and exact source splices with %j endings', (eol) => {
    const prefix = metadata.replaceAll('\n', eol) + eol + eol
    const source = prefix + '# Plan' + eol + eol + 'Keep {++this++}.' + eol
    const { tree, spans } = analyzeMarkdown(source)
    expect(tree.children.map((n) => n.type)).toEqual(['yaml', 'heading', 'paragraph'])
    expect(tree.children[1]?.position?.start.offset).toBe(prefix.length)
    expect(spans).toHaveLength(1)
    expect(applyTextEdits(source, [acceptEdit(source, spans[0]!)])).toBe(
      prefix + '# Plan' + eol + eol + 'Keep this.' + eol,
    )
  })

  it('renders metadata literally without creating a heading or a review mark', () => {
    const root = render(metadata + '\n\n# Plan\n')
    expect(root.querySelector('.md-frontmatter')?.textContent).toBe(
      'title: "{>>literal<<}"\nitems:\n  - one\n  - two',
    )
    expect(root.querySelectorAll('h1,h2,h3')).toHaveLength(1)
    expect(root.querySelectorAll('.critic')).toHaveLength(0)
  })

  it('does not offer source review ranges for literal metadata', () => {
    const source = metadata + '\n\nBody.'
    const root = render(source)
    const range = document.createRange()
    range.selectNodeContents(root.querySelector('.md-frontmatter')!)
    expect(rangeToSourceRanges(range, source, [])).toEqual({ error: 'unmapped' })
  })

  it('preserves metadata as an untranslated source block', async () => {
    const blocks = await segmentBlocks(metadata + '\n\nBody.')
    expect(blocks[0]).toMatchObject({ kind: 'yaml', text: metadata, translatable: false })
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', text: 'Body.', translatable: true })
  })

  it('leaves later separators and unclosed frontmatter as ordinary Markdown', () => {
    expect(parseMarkdown('Intro\n\n---\n\nBody').children.map((n) => n.type))
      .toEqual(['paragraph', 'thematicBreak', 'paragraph'])
    expect(parseMarkdown('---\ntitle: unfinished').children.map((n) => n.type))
      .toEqual(['thematicBreak', 'paragraph'])
  })

  it('handles empty frontmatter and HTML-looking values without executing them', () => {
    expect(parseMarkdown('---\n---\n\nBody').children[0]?.type).toBe('yaml')
    const root = render('---\ntitle: <script>alert(1)</script>\n---\n\nBody')
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('.md-frontmatter')?.textContent).toContain('<script>')
  })
})
