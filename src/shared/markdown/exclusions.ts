import type { Node, Parent } from 'unist'
import type { Range } from '../critic/types'
import { parseMarkdown } from './processor'

const EXCLUDED_TYPES = new Set(['code', 'inlineCode', 'html', 'yaml'])

/**
 * Ranges the CriticMarkup scanner must treat as opaque: fenced/indented code,
 * inline code, raw HTML, and YAML frontmatter. The plain Markdown parser
 * supplies positions from the same syntax used by the renderer.
 */
export function codeRanges(text: string): Range[] {
  const tree = parseMarkdown(text)
  const out: Range[] = []
  const visit = (node: Node): void => {
    const start = node.position?.start?.offset
    const end = node.position?.end?.offset
    if (EXCLUDED_TYPES.has(node.type) && start !== undefined && end !== undefined) {
      out.push({ start, end })
      return
    }
    const children = (node as Parent).children
    if (children) for (const child of children) visit(child)
  }
  visit(tree)
  return out.sort((a, b) => a.start - b.start)
}
