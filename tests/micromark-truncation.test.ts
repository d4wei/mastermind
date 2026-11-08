import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import golden from './micromark-truncation.golden.json'
import { parseMarkdown } from '../document/markdown/processor'

// patches/micromark+4.0.2.patch replaces micromark's `events.length = n` truncations with pop loops,
// because setting `length` on a large array is linear in JavaScriptCore and the tokenizer truncates
// on every backtrack. The golden records trees from unpatched micromark 4.0.2; each source makes the
// tokenizer backtrack or close containers into flow.

const PATCHED_VERSION = '4.0.2'
// The copy remark-parse loads, resolved the way mdast-util-from-markdown resolves it.
const require = createRequire(import.meta.url)
const fromMarkdown = require.resolve('mdast-util-from-markdown', { paths: [dirname(require.resolve('remark-parse'))] })
const micromarkEntry = require.resolve('micromark', { paths: [dirname(fromMarkdown)] })
const micromarkRoot = micromarkEntry.slice(0, micromarkEntry.lastIndexOf(join('node_modules', 'micromark')) + join('node_modules', 'micromark').length)
const patchedFiles = ['create-tokenizer.js', 'initialize/document.js'].flatMap((file) => [
  join('lib', file),
  join('dev', 'lib', file),
])

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('the micromark truncation patch', () => {
  it('applies to the installed micromark version', () => {
    const { version } = JSON.parse(readFileSync(join(micromarkRoot, 'package.json'), 'utf8')) as { version: string }
    expect(version, 'micromark changed version: re-derive patches/micromark+*.patch for it').toBe(PATCHED_VERSION)
  })

  it.each(patchedFiles)('replaces every events truncation in %s with a pop loop', (file) => {
    const code = readFileSync(join(micromarkRoot, file), 'utf8')
    expect(code, 'run `npm install` so patch-package applies patches/').not.toMatch(/events\.length = /)
    expect(code).toMatch(/while \((?:context|self)\.events\.length > \w+\) (?:context|self)\.events\.pop\(\)/)
  })

  it.each(golden.cases)('reproduces the unpatched tree for case %#', ({ source, tree }) => {
    expect(plain(parseMarkdown(source))).toEqual(tree)
  })

  it('reproduces the unpatched tree for the cases joined and repeated', () => {
    const combined = golden.cases.map(({ source }) => source).join('\n\n---\n\n').repeat(8)
    const digest = createHash('sha256').update(JSON.stringify(parseMarkdown(combined))).digest('hex')
    expect(digest).toBe(golden.combinedTreeSha256)
  })
})
