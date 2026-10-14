import type { Root } from 'mdast'
import type { Node, Parent } from 'unist'
import { scan } from '../critic/scanner'
import type { CriticSpan, Range } from '../critic/types'
import { excludedRanges } from './exclusions'
import { parseMarkdown } from './processor'

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'tableCell'])

/** Keep review actions inside the same Markdown text block as their delimiters. */
export function scanMarkdown(text: string): CriticSpan[] {
  return scanMarkdownTree(text, parseMarkdown(text))
}

/** The tree must be the plain Markdown parse of this exact source, never the masked reading tree. */
export function scanMarkdownTree(text: string, tree: Root): CriticSpan[] {
  const blocks: Range[] = []
  const visit = (node: Node): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (TEXT_BLOCKS.has(node.type) && start !== undefined && end !== undefined) {
      blocks.push({ start, end })
      return
    }
    for (const child of (node as Parent).children ?? []) visit(child)
  }
  visit(tree)
  let blockIndex = 0
  return scan(text, excludedRanges(tree)).filter((span) => {
    while (blocks[blockIndex] && blocks[blockIndex]!.end <= span.start) blockIndex++
    const block = blocks[blockIndex]
    return block !== undefined && block.start <= span.start && span.end <= block.end
  })
}
