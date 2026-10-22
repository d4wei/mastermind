import { expect, it } from 'vitest'
import { resolveAll } from '../document/critic/resolve'
import { analyzeMarkdown } from '../document/markdown/analyze'

it.each(['\n', '\r\n'])('leaves cross-list insertions literal and untouched (%j)', (eol) => {
  const unsupported = ['- first {++;', '- second item++}'].join(eol)
  const source = `${unsupported}${eol}${eol}After {++valid++}.`
  const { tree, spans, items } = analyzeMarkdown(source)
  expect(spans.map((span) => source.slice(span.start, span.end))).toEqual(['{++valid++}'])
  expect(items).toHaveLength(1)
  expect(JSON.stringify(tree)).toContain('{++;')
  expect(JSON.stringify(tree)).toContain('item++}')
  expect(resolveAll(source, spans, 'accept')).toBe(`${unsupported}${eol}${eol}After valid.`)
  expect(resolveAll(source, spans, 'reject')).toBe(`${unsupported}${eol}${eol}After .`)
})

it.each([
  '- first {--old\n- second--}',
  '- first {~~old\n- second~>new~~}',
  '- first {==anchor\n- second==}',
  '- first {>>note\n- second<<}',
  'text {++one\n# two++}',
  '| a | b |\n| - | - |\n| {++one | two++} |',
])('does not expose cross-block marks to review actions: %s', (source) => {
  const { spans, items } = analyzeMarkdown(source)
  expect(spans).toEqual([])
  expect(items).toEqual([])
  expect(resolveAll(source, spans, 'accept')).toBe(source)
})

it.each([
  '- first {++one\n  two++}',
  '> first {++one\n> two++}',
  '# Title {++new++}',
  '| a | b |\n| - | - |\n| {++one++} | two |',
])('retains marks inside a single text block: %s', (source) => {
  const { spans } = analyzeMarkdown(source)
  expect(spans).toHaveLength(1)
  expect(resolveAll(source, spans, 'accept')).toBe(source.replace('{++', '').replace('++}', ''))
})

it.each([
  ['- a {>>oops\n- b {>>real<<}', '{>>real<<}'],
  ['# T {++x\nPara {--real--} ++}', '{--real--}'],
])('finds a valid mark after an unterminated opener in the previous block: %j', (source, mark) => {
  const { spans } = analyzeMarkdown(source)
  expect(spans.map((span) => source.slice(span.start, span.end))).toEqual([mark])
})
