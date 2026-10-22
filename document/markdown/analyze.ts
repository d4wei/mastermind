import type { Root } from 'mdast'
import { group } from '../critic/scanner'
import type { CriticSpan, ReviewItem } from '../critic/types'
import { markdownProcessor } from './processor'
import { remarkCritic } from './remark-critic'

const criticProcessor = markdownProcessor().use(remarkCritic).freeze()

export interface Analysis {
  tree: Root
  spans: CriticSpan[]
  items: ReviewItem[]
}

/** Full Reading-mode pipeline: critic-aware tree + spans + grouped review items. */
export function analyzeMarkdown(text: string): Analysis {
  const file = { value: text, data: { criticSpans: [] as CriticSpan[] } }
  const tree = criticProcessor.runSync(criticProcessor.parse(file), file) as Root
  const spans = file.data.criticSpans
  return { tree, spans, items: group(spans, text) }
}
