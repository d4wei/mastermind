import { expect, it } from 'vitest'
import { mergeText } from '../document/merge'

it('merges separated changes without reserializing whitespace, metadata or review markup', () => {
  const base = '---\r\nkey:  value\r\n---\r\n\r\none\r\nmiddle\r\nlast'
  const local = base.replace('one', '{==one==}{>>@Alex: note\r\ncontinued<<}')
  const disk = base.replace('last', '{++last two++}')
  expect(mergeText(base, local, disk)).toEqual({ kind: 'clean', content: local.replace('last', '{++last two++}') })
})
it.each([
  ['a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n', 'A\nb\nC\n'],
  ['a\nb\nc', 'a\nb\nc\n', 'A\nb\nc', 'A\nb\nc\n'],
  ['a\nb\nc\nd\n', 'b\nc\nd\n', 'a\nb\nc\n', 'b\nc\n'],
  ['', 'same', 'same', 'same'],
  ['a', 'a', 'b', 'b'],
  ['a', 'b', 'a', 'b'],
])('handles insertions, deletions and identical changes', (base, local, disk, result) => {
  expect(mergeText(base, local, disk)).toEqual({ kind: 'clean', content: result })
})
it.each([
  ['a\n', 'A\n', 'B\n'],
  ['a\nb\n', 'a\nlocal\nb\n', 'a\ndisk\nb\n'],
  ['a\nb\n', 'a\n', 'a\nB\n'],
])('returns no candidate for overlap', (base, local, disk) => {
  expect(mergeText(base, local, disk)).toEqual({ kind: 'conflict' })
})
it('bounds long and highly repetitive inputs before diffing', () => {
  for (const base of ['x'.repeat(1_000_001), 'same\n'.repeat(4001), 'same\n'.repeat(1000)]) {
    expect(mergeText(base, `${base}local`, `disk${base}`)).toEqual({ kind: 'limit' })
  }
})
