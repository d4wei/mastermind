import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import golden from './from-markdown-list-events.golden.json'
import { parseMarkdown } from '../document/markdown/processor'

// mdast-util-from-markdown before 2.1.0 added `listItem` events by splicing an enter and an exit
// into the whole event array for every list item, so compiling grew quadratically with the number
// of items before the end of the document. 2.1.0 builds the event array in one pass and prepares
// each list while it is the array's tail, merging its item events in once. The golden records
// trees from 2.0.3; each source exercises a different way the list walk marks items spread or
// places their ends, and the long list makes thousands of items.

const PINNED_VERSION = '2.1.0'
// The copy remark-parse loads; the `development` export condition selects dev/, the default lib/.
const require = createRequire(import.meta.url)
const fromMarkdownEntry = require.resolve('mdast-util-from-markdown', { paths: [dirname(require.resolve('remark-parse'))] })
const packageDir = join('node_modules', 'mdast-util-from-markdown')
const packageRoot = fromMarkdownEntry.slice(0, fromMarkdownEntry.lastIndexOf(packageDir) + packageDir.length)
const compilerFiles = [join('lib', 'index.js'), join('dev', 'lib', 'index.js')]

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

// Thousands of items in tight and loose runs, with nested ordered lists, task items, CriticMarkup,
// fenced code inside items, and paragraphs that split the run into separate lists.
function longList(): string {
  let out = ''
  for (let i = 0; i < 4000; i++) {
    const loose = Math.floor(i / 50) % 2 === 1
    const task = i % 7 === 0 ? (i % 2 ? '[x] ' : '[ ] ') : ''
    const critic = i % 13 === 0 ? ` {++added ${i}++}{>>note ${i}<<}` : i % 17 === 0 ? ` {--gone--}{== hl ==}` : ''
    out += `- ${task}item ${i}${critic}\n`
    if (i % 10 === 0) out += `  1. sub ${i}.1\n  2. sub ${i}.2\n     - leaf\n`
    if (i % 97 === 0) out += '\n  ```\n  code\n  ```\n'
    if (loose) out += '\n'
    if (i % 500 === 499) out += '\nA paragraph between lists.\n\n'
  }
  return out
}

describe('mdast-util-from-markdown list preparation', () => {
  it('is the installed mdast-util-from-markdown version', () => {
    const { version } = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }
    expect(version, 'mdast-util-from-markdown changed version: recheck its list preparation and these trees').toBe(PINNED_VERSION)
  })

  it.each(compilerFiles)('collects list item events and merges them once in %s', (file) => {
    const code = readFileSync(join(packageRoot, file), 'utf8')
    expect(code).not.toMatch(/events\.splice\((?:lineIndex \|\| )?index, 0,/)
    expect(code).toMatch(/prepareList\(prepared, tail\)/)
    expect(code).toMatch(/insertions\.push\(\{\s*at: lineIndex \|\| index,/)
    expect(code).toMatch(/insertions\.push\(\{\s*at: index,\s*event: \['enter', item, event\[2\]\]\s*\}\)/)
  })

  it.each(golden.cases)('reproduces the 2.0.3 tree for case %#', ({ source, tree }) => {
    expect(plain(parseMarkdown(source))).toEqual(tree)
  })

  it('reproduces the 2.0.3 tree for a list of thousands of items', () => {
    expect(digest(parseMarkdown(longList()))).toBe(golden.longListTreeSha256)
  })

  it('reproduces the 2.0.3 tree for the cases joined and repeated', () => {
    const combined = golden.cases.map(({ source }) => source).join('\n\n---\n\n').repeat(40)
    expect(digest(parseMarkdown(combined))).toBe(golden.combinedTreeSha256)
  })
})
