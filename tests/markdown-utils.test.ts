import { describe, expect, it } from 'vitest'
import { applyTextEdits } from '../document/edits'
import { detectEol, normalizeToLf, restoreEol } from '../document/eol'
import { parseMarkdown } from '../document/markdown/processor'
import { toggleTaskEdit } from '../document/markdown/tasklist'

describe('eol', () => {
  it('detects lf', () => {
    expect(detectEol('a\nb\n')).toBe('lf')
  })
  it('detects crlf', () => {
    expect(detectEol('a\r\nb\r\n')).toBe('crlf')
  })
  it('counts consecutive bare newlines toward lf', () => {
    expect(detectEol('a\r\nb\r\n\n\n\n\n')).toBe('lf')
    expect(detectEol('a\r\nb\r\n\n\n')).toBe('crlf')
  })
  it('round-trips crlf', () => {
    const original = '# Hi\r\n\r\ntext\r\n'
    const lf = normalizeToLf(original)
    expect(lf).toBe('# Hi\n\ntext\n')
    expect(restoreEol(lf, 'crlf')).toBe(original)
  })
})

describe('applyTextEdits', () => {
  it('applies multiple edits right-to-left', () => {
    expect(
      applyTextEdits('hello world', [
        { from: 0, to: 5, insert: 'goodbye' },
        { from: 6, to: 11, insert: 'moon' },
      ]),
    ).toBe('goodbye moon')
  })
  it('rejects overlapping edits', () => {
    expect(() =>
      applyTextEdits('abcdef', [
        { from: 0, to: 3, insert: 'x' },
        { from: 2, to: 4, insert: 'y' },
      ]),
    ).toThrow()
  })
})

describe('task list toggling', () => {
  const doc = '# Plan\n\n- [ ] first\n- [x] second\n  - [ ] nested\n\n1. [ ] ordered\n'

  function itemStarts(source: string): number[] {
    const tree = parseMarkdown(source)
    const starts: number[] = []
    const walk = (node: { type?: string; checked?: boolean | null; children?: unknown[]; position?: { start?: { offset?: number } } }) => {
      if (node.type === 'listItem' && typeof node.checked === 'boolean') {
        starts.push(node.position!.start!.offset!)
      }
      for (const child of (node.children ?? []) as never[]) walk(child)
    }
    walk(tree as never)
    return starts.sort((a, b) => a - b)
  }

  it('finds markers for bullet, nested, and ordered task items', () => {
    const starts = itemStarts(doc)
    expect(starts).toHaveLength(4)
    expect(starts.map((s) => toggleTaskEdit(doc, s)?.insert)).toEqual(['x', ' ', 'x', 'x'])
  })

  it('toggles unchecked → checked', () => {
    const starts = itemStarts(doc)
    const edit = toggleTaskEdit(doc, starts[0]!)
    const next = applyTextEdits(doc, [edit!])
    expect(next).toBe(doc.replace('- [ ] first', '- [x] first'))
  })

  it('toggles checked → unchecked without touching others', () => {
    const starts = itemStarts(doc)
    const edit = toggleTaskEdit(doc, starts[1]!)
    const next = applyTextEdits(doc, [edit!])
    expect(next).toBe(doc.replace('- [x] second', '- [ ] second'))
  })
})
