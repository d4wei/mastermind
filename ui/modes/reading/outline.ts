import type { Root } from 'mdast'
import type { Node, Parent } from 'unist'

export interface OutlineItem {
  depth: number
  text: string
  offset: number
}

/** Concatenated literal values beneath a node, without Markdown syntax. */
export function plainText(node: Node): string {
  let s = ''
  const walk = (n: Node): void => {
    const v = (n as { value?: string }).value
    if (typeof v === 'string') s += v
    const kids = (n as Parent).children
    if (kids) for (const k of kids) walk(k)
  }
  walk(node)
  return s
}

export function extractOutline(tree: Root): OutlineItem[] {
  const out: OutlineItem[] = []
  for (const node of tree.children) {
    if (node.type === 'heading') {
      const offset = node.position?.start?.offset
      if (offset === undefined) continue
      out.push({ depth: node.depth, text: plainText(node), offset })
    }
  }
  return out
}
