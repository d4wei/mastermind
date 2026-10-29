import type { Root } from 'mdast'
import { maskSource, pickSentinels } from '../critic/mask'
import { group, threadCards } from '../critic/scanner'
import type { CriticSpan, ReviewItem, ThreadCard } from '../critic/types'
import { criticTransform } from './critic-mdast'
import { parseMarkdown } from './processor'
import { scanMarkdownTree } from './scan'

/** A review mark the overview gutter points at: a suggestion, or a discussion's first span. */
export interface MarkTick {
  spanIndex: number
  kind: 'ins' | 'del' | 'sub' | 'comment'
}

/** Everything Reading mode derives from one source; consumers index into it rather than recompute. */
export interface Analysis {
  /** The plain Markdown parse: review boundaries, exclusions, and selection mapping read it. */
  plain: Root
  /** The reading tree, with review marks as critic nodes; `plain` itself when there are no marks. */
  tree: Root
  spans: CriticSpan[]
  items: ReviewItem[]
  threads: ThreadCard[]
  ticks: MarkTick[]
}

/**
 * Parses the source once as plain Markdown to find its review marks, and once more with the marks
 * masked, so that critic nodes replace them without changing the Markdown structure around them.
 */
export function analyzeMarkdown(source: string): Analysis {
  const plain = parseMarkdown(source)
  const sentinels = pickSentinels(source)
  // Without free sentinels the marks cannot be masked; the source then reads as plain Markdown.
  const spans = sentinels ? scanMarkdownTree(source, plain) : []
  let tree = plain
  if (spans.length > 0) {
    const mask = maskSource(source, spans, sentinels!)
    tree = parseMarkdown(mask.masked)
    criticTransform(tree, source, spans, mask)
  }
  const items = group(spans, source)
  const spanIndex = new Map(spans.map((span, index) => [span, index]))
  const ticks = items.flatMap((item): MarkTick[] => {
    // Standalone highlights render as plain text and have no gutter target.
    if (item.type === 'highlight') return []
    if (item.type === 'thread') return [{ spanIndex: spanIndex.get(item.anchor ?? item.comments[0]!.span)!, kind: 'comment' }]
    return [{ spanIndex: spanIndex.get(item.span)!, kind: item.span.kind as MarkTick['kind'] }]
  })
  return { plain, tree, spans, items, threads: threadCards(items, spanIndex, source), ticks }
}
