import { expect, it } from 'vitest'
import { usableAuthorName } from '../src/shared/author'

it.each([
  ['李 明', '李 明'], [' Alex Chen ', 'Alex Chen'], ['\ufeff @ Alex \ufeff', 'Alex'], ['\u0085Alex\u0085', '\u0085Alex\u0085'], [' @ 李 明 ', '李 明'],
  ['a'.repeat(64), 'a'.repeat(64)], ['😀'.repeat(32), '😀'.repeat(32)],
])('normalizes a scanner-readable Name %j', (value, normalized) => {
  expect(usableAuthorName(value)).toBe(normalized)
})

it.each([
  '', '\ufeff', ' @ ', '@@reader', 'a'.repeat(65), '😀'.repeat(33),
  ...[':', '@', '{', '}', '<', '>', '=', '|', '\n', '\t', '\u0000', '\u001f', '\u2028', '\u2029']
    .map((delimiter) => `Alex${delimiter}Chen`),
])('refuses a Name that cannot round-trip through comment authorship: %j', (value) => {
  expect(usableAuthorName(value)).toBeNull()
})
