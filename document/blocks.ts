import type { ListItem, Root, RootContent } from 'mdast'
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

/**
 * The units translation segments by, in source order: the top-level blocks, with each top-level
 * list replaced by its items.
 */
export function blockUnits(tree: Root): Array<RootContent | ListItem> {
  return tree.children.flatMap((node) => node.type === 'list' ? node.children : [node])
}

/** Split raw source into top-level blocks and individual list items, preserving source offsets. */
export function segmentBlocks(text: string): SourceBlock[] {
  const out: SourceBlock[] = []
  for (const node of blockUnits(parseMarkdown(text))) {
    const start = node.position?.start?.offset
    const end = node.position?.end?.offset
    if (start === undefined || end === undefined || end <= start) continue
    out.push({
      text: text.slice(start, end),
      start,
      end,
      kind: node.type,
      translatable: !UNTRANSLATABLE.has(node.type),
    })
  }
  return out
}
