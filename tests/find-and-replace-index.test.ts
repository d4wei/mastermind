import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import golden from './find-and-replace-index.golden.json'
import { parseMarkdown } from '../document/markdown/processor'

// patches/mdast-util-find-and-replace+3.0.2.patch replaces the `siblings.indexOf` lookups in
// findAndReplace, which remark-gfm runs over every text node to find autolink literals, with a
// lookup that resumes where the last one in the same `children` stopped. Scanning the root's
// children from the start for every text node made the walk quadratic in the number of top-level
// blocks, in V8 and JavaScriptCore alike. The golden records trees from the unpatched package; each
// source puts autolink literals in a different container, including ones the walk must ignore.

const PATCHED_VERSION = '3.0.2'
// The copy remark-gfm loads, resolved the way mdast-util-gfm-autolink-literal resolves it.
const require = createRequire(import.meta.url)
const autolinkLiteral = require.resolve('mdast-util-gfm-autolink-literal', {
  paths: [dirname(require.resolve('mdast-util-gfm', { paths: [dirname(require.resolve('remark-gfm'))] }))],
})
const findAndReplaceEntry = require.resolve('mdast-util-find-and-replace', { paths: [dirname(autolinkLiteral)] })
const packageRoot = dirname(findAndReplaceEntry)

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('the find-and-replace index patch', () => {
  it('applies to the installed mdast-util-find-and-replace version', () => {
    const { version } = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }
    expect(version, 'mdast-util-find-and-replace changed version: re-derive or drop patches/mdast-util-find-and-replace+*.patch').toBe(PATCHED_VERSION)
  })

  it('replaces both sibling index lookups with the resuming one', () => {
    const code = readFileSync(join(packageRoot, 'lib', 'index.js'), 'utf8')
    expect(code, 'run `npm install` so patch-package applies patches/').not.toMatch(
      /siblings \? siblings\.indexOf\(parent\)|const index = siblings\.indexOf\(node\)/,
    )
    expect(code).toMatch(/siblings \? indexIn\(siblings, parent\) : undefined/)
    expect(code).toMatch(/const index = indexIn\(siblings, node\)/)
  })

  it.each(golden.cases)('reproduces the unpatched tree for case %#', ({ source, tree }) => {
    expect(plain(parseMarkdown(source))).toEqual(tree)
  })

  it('reproduces the unpatched tree for the cases joined and repeated', () => {
    const combined = golden.cases.map(({ source }) => source).join('\n\n---\n\n').repeat(40)
    const digest = createHash('sha256').update(JSON.stringify(parseMarkdown(combined))).digest('hex')
    expect(digest).toBe(golden.combinedTreeSha256)
  })
})
