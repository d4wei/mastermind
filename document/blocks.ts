import type { ListItem, RootContent } from 'mdast'
import { parseMarkdown } from './markdown/processor'

interface SourceBlock {
  text: string
  start: number
  end: number
  kind: string
  /** Literal blocks, including frontmatter, are never translated. */
  translatable: boolean
}

const UNTRANSLATABLE = new Set(['code', 'html', 'yaml', 'thematicBreak', 'definition'])

/** Split raw source into top-level blocks and individual list items, preserving source offsets. */
export function segmentBlocks(text: string): SourceBlock[] {
  const tree = parseMarkdown(text)
  const out: SourceBlock[] = []

  const push = (node: RootContent | ListItem, kind: string): void => {
    const start = node.position?.start?.offset
    const end = node.position?.end?.offset
    if (start === undefined || end === undefined || end <= start) return
    const slice = text.slice(start, end)
    out.push({
      text: slice,
      start,
      end,
      kind,
      translatable: !UNTRANSLATABLE.has(kind),
    })
  }

  for (const node of tree.children) {
    if (node.type === 'list') {
      for (const item of node.children) push(item, 'listItem')
      continue
    }
    push(node, node.type)
  }
  return out
}
