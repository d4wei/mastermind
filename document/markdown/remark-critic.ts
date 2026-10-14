import type { Root } from 'mdast'
import type { Node } from 'unist'
import type { Processor, Transformer } from 'unified'
import type { VFile } from 'vfile'
import { maskSource, type Sentinels } from '../critic/mask'
import type { CriticSpan } from '../critic/types'
import { criticTransform } from './critic-mdast'
import { scanMarkdown } from './scan'

interface CriticState {
  original: string
  spans: CriticSpan[]
  sentinels: Sentinels | null
}

declare module 'vfile' {
  interface DataMap {
    criticState?: CriticState
    criticSpans?: CriticSpan[]
  }
}

/**
 * Mask CriticMarkup before GFM parsing, retaining original source positions,
 * then rebuild typed critic nodes from the sentinel runs during transformation.
 */
export function remarkCritic(this: Processor): Transformer<Root> {
  const self = this as Processor & {
    parser?: (doc: string, file: VFile) => Node
  }

  const inner = self.parser
  if (typeof inner === 'function') {
    self.parser = (doc: string, file: VFile): Node => {
      const spans = scanMarkdown(doc)
      const state: CriticState = { original: doc, spans, sentinels: null }
      file.data.criticState = state
      file.data.criticSpans = spans
      if (spans.length > 0) {
        const { masked, sentinels } = maskSource(doc, spans)
        state.sentinels = sentinels
        return inner.call(self, masked, file)
      }
      return inner.call(self, doc, file)
    }
  }

  return (tree, file) => {
    const state = file.data.criticState
    if (state && state.spans.length > 0 && state.sentinels) {
      criticTransform(tree, state.original, state.spans, state.sentinels)
    }
  }
}
