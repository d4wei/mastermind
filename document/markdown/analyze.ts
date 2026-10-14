import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { group } from '../critic/scanner'
import type { CriticSpan, ReviewItem } from '../critic/types'
import { remarkCritic } from './remark-critic'

const criticProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter).use(remarkCritic).freeze()

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
