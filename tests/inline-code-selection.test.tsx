// @vitest-environment jsdom
import { renderMarkdown } from './helpers/markdown'
import { describe, expect, it } from 'vitest'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { applyTextEdits } from '../document/edits'
import { resolveAll } from '../document/critic/resolve'
import { mapSelection, type SelRange, type SelectionMapping } from '../ui/modes/reading/selection'
import { changeEdits, commentEdits } from '../ui/modes/reading/marks'

function segments(mapping: SelectionMapping): SelRange[] {
  if (mapping.status !== 'covered') throw new Error(`expected coverage, got ${mapping.status}`)
  return mapping.segments
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
      const rendered = renderMarkdown(source)
      const { host } = rendered
      const range = select(host.querySelector('code')!.firstChild!)
      const mapped = segments(mapSelection(range, source, rendered))
      expect(mapped).toEqual([{ from: 4, to: 4 + code.length, text: code }])
      const updated = applyTextEdits(source, commentEdits(source, mapped, 'Alex', 'Keep `open` focused.')!)
      expect(updated).toBe(`Try {==${code}==}{>>@Alex: Keep \`open\` focused.<<} now.`)
      const next = renderMarkdown(updated)
      expect(next.items).toHaveLength(1)
      expect(next.items[0]).toMatchObject({ type: 'thread', comments: [{ author: 'Alex', body: 'Keep `open` focused.' }] })
      expect(next.host.textContent).not.toContain('{==')
      expect(next.host.textContent).not.toContain('Keep `open` focused.')
      expect(next.host.querySelector('code')!.textContent).toBe(host.querySelector('code')!.textContent)
      const deletion = applyTextEdits(source, changeEdits(source, mapped, mapped.map(() => ''))!)
      const deletionSpans = analyzeMarkdown(deletion).spans
      expect(deletionSpans).toHaveLength(1)
      expect(resolveAll(deletion, deletionSpans, 'reject')).toBe(source)
      expect(resolveAll(deletion, deletionSpans, 'accept')).toBe('Try  now.')
    },
  )

  it('accepts a DOM element-boundary selection of the complete code', () => {
    const source = 'Use `command`.'
    const { host } = renderMarkdown(source)
    const range = document.createRange()
    range.selectNode(host.querySelector('code')!)
    expect(segments(mapSelection(range, source, analyzeMarkdown(source)))).toEqual([{ from: 4, to: 13, text: '`command`' }])
  })

  it('does not expand a partial code selection into a deletion of the entire code', () => {
    const source = 'Try `open -- docs/plan.md` now.'
    const { host } = renderMarkdown(source)
    const range = select(host.querySelector('code')!.firstChild!, 0, 4)
    expect(mapSelection(range, source, analyzeMarkdown(source))).toMatchObject({
      segments: [], excluded: [{ text: 'open', reason: 'partial-code' }],
    })
  })

  it('does not offer marks inside fenced code', () => {
    const source = '```sh\ncommand\n```'
    const { host } = renderMarkdown(source)
    const range = select(host.querySelector('code')!.firstChild!)
    expect(mapSelection(range, source, analyzeMarkdown(source))).toMatchObject({
      segments: [], excluded: [{ text: 'command', reason: 'opaque-block' }],
    })
  })

  it('retains selected comments around code and does not nest marks around an existing anchor', () => {
    const source = '`command`'
    const { host } = renderMarkdown(source)
    const ranges = segments(mapSelection(select(host.querySelector('code')!.firstChild!), source, analyzeMarkdown(source)))
    const updated = applyTextEdits(source, commentEdits(source, ranges, 'Alex', 'Review this.')!)
    const next = renderMarkdown(updated)
    expect(next.spans).toHaveLength(2)
    const selection = select(next.host.querySelector('code')!.firstChild!)
    expect(mapSelection(selection, updated, next)).toMatchObject({ segments: [], excluded: [{ reason: 'existing-mark' }] })
  })
})
