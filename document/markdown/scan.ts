import type { Root } from 'mdast'
import { SKIP, visit } from 'unist-util-visit'
import { scan } from '../critic/scanner'
import type { CriticSpan, Range } from '../critic/types'
import { excludedRanges } from './exclusions'
import { parseMarkdown } from './processor'

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'tableCell'])

/** Source ranges of the paragraphs, headings, and table cells in a plain Markdown tree, in source order. */
export function textBlockRanges(tree: Root): Range[] {
  const blocks: Range[] = []
  visit(tree, (node) => {
    if (!TEXT_BLOCKS.has(node.type)) return
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) blocks.push({ start, end })
    return SKIP
  })
  return blocks
}

/** Find review marks, each confined to one Markdown text block. */
export function scanMarkdown(text: string): CriticSpan[] {
  return scanMarkdownTree(text, parseMarkdown(text))
}

/** The tree must be the plain Markdown parse of this exact source, never the masked reading tree. */
export function scanMarkdownTree(text: string, tree: Root): CriticSpan[] {
  return scan(text, excludedRanges(tree), textBlockRanges(tree))
}
