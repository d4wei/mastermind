// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { analyzeMarkdown } from '../src/shared/markdown/analyze'
import { applyTextEdits } from '../src/shared/edits'
import { resolveAll } from '../src/shared/critic/resolve'
import { MarkdownView } from '../src/ui/modes/reading/Renderer'
import { blockContentRanges, markEdits, rangeToSource, rangeToSourceRanges } from '../src/ui/modes/reading/selection'
import { commentEdits, deletionWrap } from '../src/ui/modes/reading/marks'

function render(source: string) {
  const analysis = analyzeMarkdown(source)
  const host = document.createElement('article')
  host.innerHTML = renderToStaticMarkup(<MarkdownView tree={analysis.tree} ctx={{ source }} />)
  return { host, ...analysis }
}

function select(node: Node, from = 0, to = node.textContent!.length) {
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to)
  return range
}

describe('reviewing inline code', () => {
  it.each(['`open -- docs/plan.md`', '``a ` b``', '` padded `', '`one\ntwo`'])(
    'puts the anchor outside the code delimiters: %s', (code) => {
      const source = `Try ${code} now.`
      const { host, spans } = render(source)
      const range = select(host.querySelector('code')!.firstChild!)
      const mapped = rangeToSourceRanges(range, source, spans)
      if (!('ranges' in mapped)) throw new Error(mapped.error)
      expect(mapped.ranges).toEqual([{ from: 4, to: 4 + code.length, text: code }])
      expect(rangeToSource(range, source, spans)).toEqual(mapped.ranges[0])
      const updated = applyTextEdits(source, commentEdits(mapped.ranges, 'Alex', 'Keep `open` focused.'))
      expect(updated).toBe(`Try {==${code}==}{>>@Alex: Keep \`open\` focused.<<} now.`)
      const next = render(updated)
      expect(next.items).toHaveLength(1)
      expect(next.items[0]).toMatchObject({ type: 'thread', comments: [{ author: 'Alex', body: 'Keep `open` focused.' }] })
      expect(next.host.textContent).not.toContain('{==')
      expect(next.host.textContent).not.toContain('Keep `open` focused.')
      expect(next.host.querySelector('code')!.textContent).toBe(host.querySelector('code')!.textContent)
      const deletion = applyTextEdits(source, markEdits(mapped.ranges, deletionWrap))
      const deletionSpans = analyzeMarkdown(deletion).spans
      expect(deletionSpans).toHaveLength(1)
      expect(resolveAll(deletion, deletionSpans, 'reject')).toBe(source)
      expect(resolveAll(deletion, deletionSpans, 'accept')).toBe('Try  now.')
    },
  )

  it('accepts a DOM element-boundary selection of the complete code', () => {
    const source = 'Use `command`.'
    const { host } = render(source)
    const range = document.createRange()
    range.selectNode(host.querySelector('code')!)
    const mapped = rangeToSourceRanges(range, source, [])
    expect(mapped).toEqual({ ranges: [{ from: 4, to: 13, text: '`command`' }] })
  })

  it('does not expand a partial code selection into a deletion of the entire code', () => {
    const source = 'Try `open -- docs/plan.md` now.'
    const { host } = render(source)
    const range = select(host.querySelector('code')!.firstChild!, 0, 4)
    expect(rangeToSourceRanges(range, source, [])).toEqual({ error: 'unmapped' })
    expect(rangeToSource(range, source, [])).toEqual({ error: 'unmapped' })
  })

  it('does not offer marks inside fenced code', () => {
    const source = '```sh\ncommand\n```'
    const { host } = render(source)
    const range = select(host.querySelector('code')!.firstChild!)
    expect(rangeToSourceRanges(range, source, [])).toEqual({ error: 'unmapped' })
    expect(blockContentRanges(host.querySelector('pre')!, source, [])).toEqual([])
  })

  it('retains block comments around code and does not nest marks around an existing anchor', () => {
    const source = '`command`'
    const { host } = render(source)
    const ranges = blockContentRanges(host.querySelector('p')!, source, [])
    const updated = applyTextEdits(source, commentEdits(ranges, 'Alex', 'Review this.'))
    const next = render(updated)
    expect(next.spans).toHaveLength(2)
    const selection = select(next.host.querySelector('code')!.firstChild!)
    expect(rangeToSourceRanges(selection, updated, next.spans)).toEqual({ error: 'unmapped' })
  })
})
