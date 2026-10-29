// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { parseMarkdown } from '../document/markdown/processor'
import { segmentBlocks } from '../document/blocks'
import { applyTextEdits } from '../document/edits'
import { acceptEdit } from '../document/critic/resolve'
import { MarkdownView } from '../ui/modes/reading/Renderer'
import { mapSelection } from '../ui/modes/reading/selection'
import { metadataProperties } from '../ui/modes/reading/Frontmatter'

const metadata = '---\ntitle: "{>>literal<<}"\nitems:\n  - one\n  - two\n---'

function render(source: string): HTMLElement {
  const root = document.createElement('article')
  root.innerHTML = renderToStaticMarkup(<MarkdownView analysis={analyzeMarkdown(source)} ctx={{ source }} />)
  return root
}

describe('YAML frontmatter', () => {
  it('shows ordered scalar properties with decoded strings and exact nonstring spelling', () => {
    const yaml = '# Keep this comment\n"标题": "方案\\n第二行"\ncount: 9007199254740993\nready: TRUE\nempty:\nnone: ~\ncode: 01'
    const root = render(`---\n${yaml}\n---\n\nBody.`)
    const rows = [...root.querySelectorAll('.md-property')].map((row) =>
      [row.querySelector('dt')!.textContent, row.querySelector('dd')!.textContent])
    expect(rows).toEqual([
      ['标题', '方案\n第二行'], ['count', '9007199254740993'], ['ready', 'TRUE'],
      ['empty', ''], ['none', '~'], ['code', '01'],
    ])
    expect(root.querySelector('.md-frontmatter details')).toBeNull()
    expect(root.querySelector('.md-frontmatter pre')).toBeNull()
    expect(root.querySelector('.md-frontmatter [data-ps]')).toBeNull()
  })

  it.each([
    '', '# comment only', 'items: [one, two]', 'nested:\n  key: value',
    'a: first\na: second', 'a: [unfinished', 'a: &name value\nb: *name',
    '&key name: value', 'a: !custom value', 'a: !!str value',
    '<<: value', '? [a, b]\n: value', '12: value', ': value',
    '%YAML 1.1\n---\na: yes', '%TAG !x! tag:example.com,2026:\n---\na: value',
    'a: one\n---\na: two', 'a: one\n...',
  ])('falls back to exact literal YAML for unsupported metadata: %s', (yaml) => {
    expect(metadataProperties(yaml)).toBeNull()
  })

  it('keeps oversized metadata literal instead of parsing properties', () => {
    const yaml = 'description: ' + 'x'.repeat(64 * 1024)
    expect(metadataProperties(yaml)).toBeNull()
    const root = render(`---\n${yaml}\n---\n\nBody`)
    expect(root.querySelector('dl')).toBeNull()
    expect(root.querySelector('.md-frontmatter code')!.textContent).toBe(yaml)
  })

  it('renders block strings and HTML-looking properties as inert text', () => {
    const root = render('---\ndescription: |\n  First line\n  Second line\nhtml: "<script>alert(1)</script>"\n---\n\nBody')
    expect([...root.querySelectorAll('dd')].map((node) => node.textContent)).toEqual([
      'First line\nSecond line\n', '<script>alert(1)</script>',
    ])
    expect(root.querySelector('script')).toBeNull()
  })

  it.each(['\n', '\r\n'])('keeps property selections outside review and body splices exact with %j', (eol) => {
    const prefix = ['---', 'title: "{>>literal<<}"', '# keep comment', 'ready: true', '---', '', ''].join(eol)
    const source = prefix + 'Body {++addition++}.' + eol
    const root = render(source)
    const metadataRange = document.createRange()
    metadataRange.selectNodeContents(root.querySelector('dd')!)
    expect(mapSelection(metadataRange, source, analyzeMarkdown(source))).toMatchObject({
      segments: [], excluded: [{ reason: 'opaque-block' }],
    })
    const body = root.querySelector('p')!
    const crossing = document.createRange()
    crossing.setStart(root.querySelector('dt')!.firstChild!, 0)
    const bodyText = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode()!
    crossing.setEnd(bodyText, 4)
    const mapped = mapSelection(crossing, source, analyzeMarkdown(source))
    expect(mapped).toMatchObject({ segments: [{ from: prefix.length, to: prefix.length + 4, text: 'Body' }],
      excluded: [{ reason: 'opaque-block' }] })
    const { spans } = analyzeMarkdown(source)
    expect(spans).toHaveLength(1)
    expect(applyTextEdits(source, [acceptEdit(source, spans[0]!)])).toBe(prefix + 'Body addition.' + eol)
  })

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
    expect(mapSelection(range, source, analyzeMarkdown(source))).toMatchObject({
      segments: [], excluded: [{ reason: 'opaque-block' }],
    })
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
