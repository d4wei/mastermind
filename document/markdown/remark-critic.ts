import type { Root } from 'mdast'
import type { Node } from 'unist'
import type { Processor, Transformer } from 'unified'
import type { VFile } from 'vfile'
import { maskSource, type Sentinels } from '../critic/mask'
import type { CriticSpan } from '../critic/types'
import { criticTransform } from './critic-mdast'
import { scanMarkdown } from './scan'

/** Present only when the parsed source had marks and was masked. */
interface CriticState {
  original: string
  sentinels: Sentinels
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
      file.data.criticSpans = spans
      file.data.criticState = undefined
      if (spans.length === 0) return inner.call(self, doc, file)
      const { masked, sentinels } = maskSource(doc, spans)
      file.data.criticState = { original: doc, sentinels }
      return inner.call(self, masked, file)
    }
  }

  return (tree, file) => {
    const state = file.data.criticState
    const spans = file.data.criticSpans
    if (state && spans) criticTransform(tree, state.original, spans, state.sentinels)
  }
}
