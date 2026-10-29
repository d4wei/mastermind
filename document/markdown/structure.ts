import type { Nodes, Parent, Root } from 'mdast'
import type { Range } from '../critic/types'
import type { TextProvenance } from './provenance'

const CRITIC_TYPES = new Set(['criticInsert', 'criticDelete', 'criticHighlight', 'criticSub', 'criticComment'])
const CRITIC_WRAPPERS = new Set(['criticInsert', 'criticDelete', 'criticHighlight'])
const UNCOMPARED = new Set(['type', 'children', 'position', 'data', 'value'])
/** Blocks stay in a shape even when an omitted range spans their whole content, as a mark may. */
const BLOCKS = new Set(['root', 'paragraph', 'heading', 'blockquote', 'list', 'listItem', 'table', 'tableRow',
  'tableCell', 'footnoteDefinition'])

export interface ShapeOmissions {
  /** Source left out: inline nodes inside are skipped whole, and text characters from it are dropped. */
  ranges?: readonly Range[]
  /** Review marks left out, by span index: a wrapper keeps its content in place, an atom leaves nothing. */
  spanIndexes?: ReadonlySet<number>
}

/**
 * The reading structure of a tree, ignoring positions: each node's type and the attributes it
 * renders, nested in document order, and the text between them. Omitted source and marks leave no
 * trace, so text on either side of an omission joins up, and an omitted wrapper mark's content reads
 * as if it were unmarked. Two trees whose shapes match render the same Markdown structure outside
 * their omitted source. Existing marks keep their kind and content but not their span index, which
 * shifts when marks are added before them.
 */
export function readingShape(tree: Root, provenance: TextProvenance, omit: ShapeOmissions = {}): string {
  const ranges = omit.ranges ?? []
  const inside = (start: number, end: number): boolean =>
    ranges.some((range) => range.start <= start && end <= range.end && range.start < range.end)
  const tokens: string[] = []
  let text = ''
  const flush = (): void => {
    if (text) tokens.push(JSON.stringify(text))
    text = ''
  }
  const walk = (node: Nodes): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    const data = (node as { data?: Record<string, unknown> }).data
    if (CRITIC_TYPES.has(node.type) && omit.spanIndexes?.has(data?.spanIndex as number)) {
      if (CRITIC_WRAPPERS.has(node.type)) for (const child of (node as Parent).children) walk(child as Nodes)
      return
    }
    if (start !== undefined && end !== undefined && !BLOCKS.has(node.type) && inside(start, end)) return
    if (node.type === 'text') {
      const runs = provenance.get(node)
      if (!runs || !ranges.length) { text += node.value; return }
      for (const run of runs) {
        const literal = run.valueEnd - run.valueStart === run.sourceEnd - run.sourceStart
        for (let at = run.valueStart; at < run.valueEnd; at++) {
          const from = literal ? run.sourceStart + at - run.valueStart : run.sourceStart
          if (!inside(from, literal ? from + 1 : run.sourceEnd)) text += node.value[at]
        }
      }
      return
    }
    flush()
    const attributes: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) if (!UNCOMPARED.has(key)) attributes[key] = value
    if ('value' in node) attributes.value = node.value
    if (CRITIC_TYPES.has(node.type) && data) {
      const { spanIndex: _shifts, ...content } = data
      attributes.data = content
    }
    tokens.push(`<${node.type} ${JSON.stringify(attributes)}>`)
    for (const child of (node as Partial<Parent>).children ?? []) walk(child as Nodes)
    flush()
    tokens.push(`</${node.type}>`)
  }
  walk(tree)
  flush()
  return tokens.join('\n')
}
