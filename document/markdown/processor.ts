import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

/** The frozen GFM + frontmatter pipeline; extend it by calling it for an unfrozen copy. */
const markdownProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter).freeze()

const BYTE_ORDER_MARK = '\ufeff'

/**
 * Parse Markdown (GFM and leading YAML frontmatter) to mdast with position offsets intact.
 * Offsets index `text` itself: the parser drops a leading byte order mark without counting it,
 * so the tree is parsed without the mark and shifted past it.
 */
export function parseMarkdown(text: string): Root {
  const bom = text.startsWith(BYTE_ORDER_MARK)
  const tree = markdownProcessor.runSync(markdownProcessor.parse(bom ? text.slice(1) : text)) as Root
  if (bom) {
    visit(tree, (node) => {
      for (const point of node.position ? [node.position.start, node.position.end] : []) {
        if (point.offset !== undefined) point.offset += 1
        if (point.line === 1) point.column += 1
      }
    })
  }
  return tree
}
