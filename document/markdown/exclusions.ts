import type { Parent } from 'mdast'
import type { Node } from 'unist'
import { SKIP, visit } from 'unist-util-visit'
import type { Range } from '../critic/types'

const OPAQUE_TYPES = new Set(['code', 'inlineCode', 'html', 'yaml', 'image', 'imageReference'])

/**
 * Ranges the CriticMarkup scanner must treat as opaque, in source order:
 * fenced/indented code, inline code, raw HTML, YAML frontmatter, images and
 * image references whole (alt text is an attribute, not rendered prose), and
 * each link's destination — everything after its text, or the whole link when
 * it has no text. The tree must be the plain Markdown parse of the scanned
 * source, so positions come from the same syntax the renderer uses.
 */
export function excludedRanges(tree: Node): Range[] {
  const out: Range[] = []
  visit(tree, (node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return
    if (OPAQUE_TYPES.has(node.type)) {
      out.push({ start, end })
      return SKIP
    }
    if (node.type === 'link') {
      const textEnd = (node as Parent).children.at(-1)?.position?.end.offset
      out.push({ start: textEnd ?? start, end })
    }
  })
  return out.sort((a, b) => a.start - b.start)
}
