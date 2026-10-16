import { useEffect, useMemo, useState, type RefObject } from 'react'
import { prepareTranslation, type TranslationBlock, type PreparedTranslation } from '../../document/translation'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import { useT } from '../i18n'
import { CALLOUT_HEADING, MarkdownView, calloutKind, type CalloutKind } from '../modes/reading/Renderer'
import { useConfig } from '../app/configStore'
import { CommentBody } from '../review/CommentBody'

/** Callout structure follows source headings so translated headings cannot change grouping. */
function sourceHeading(block: TranslationBlock): { depth: number; callout: boolean; kind: CalloutKind | null } | null {
  if (block.kind !== 'heading') return null
  const m = block.text.match(/^(#{1,6})\s+([^\n]*)/)
  if (!m) return null
  const title = m[2]!.trim()
  return { depth: m[1]!.length, callout: CALLOUT_HEADING.test(title), kind: calloutKind(title) }
}

type BlockGroup =
  | { callout: false; block: TranslationBlock }
  | { callout: true; key: string; kind: CalloutKind | null; blocks: TranslationBlock[] }

function groupBlocks(blocks: TranslationBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = []
  let i = 0
  while (i < blocks.length) {
    const head = sourceHeading(blocks[i]!)
    if (head?.callout) {
      let j = i + 1
      while (j < blocks.length) {
        const next = sourceHeading(blocks[j]!)
        if (next && next.depth <= head.depth) break
        j++
      }
      groups.push({ callout: true, key: `${blocks[i]!.id}-${blocks[i]!.start}`, kind: head.kind, blocks: blocks.slice(i, j) })
      i = j
    } else {
      groups.push({ callout: false, block: blocks[i]! })
      i++
    }
  }
  return groups
}

interface Props {
  sessionId: string
  source: string
  artifact: PreparedTranslation
  containerRef: RefObject<HTMLElement | null>
}

function TransBlock({ block, translated }: { block: TranslationBlock; translated?: string }) {
  const highlightCode = (useConfig((state) => state.config?.codeTheme) ?? 'none') !== 'none'
  const shown = translated ?? block.text
  const analysis = useMemo(() => analyzeMarkdown(shown), [shown])
  return <div className="trans-block">
    <div className="trans-block-body md-root" data-trans-block-id={block.translatable ? block.id : undefined}>
      <MarkdownView tree={analysis.tree} ctx={{ source: shown, reviewSpans: analysis.spans, highlightCode }} />
    </div>
  </div>
}

export function TranslatedView({ source, artifact, containerRef }: Props) {
  const t = useT()
  const [prepared, setPrepared] = useState<{ source: string; blocks: TranslationBlock[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    void prepareTranslation(source).then((projection) => {
      if (!cancelled && projection.sourceHash === artifact.sourceHash) setPrepared({ source, blocks: projection.blocks })
    })
    return () => { cancelled = true }
  }, [source, artifact])
  if (!prepared || prepared.source !== source) return null
  const map = new Map(artifact.blocks.map((block) => [block.id, block.text]))
  const renderBlock = (block: TranslationBlock) => <TransBlock key={block.id} block={block}
    translated={block.translatable ? map.get(block.id) : undefined} />
  const comments = analyzeMarkdown(source).items.flatMap((item) => item.type === 'thread' ? item.comments : [])
  return <>
    <article className="trans-view" ref={containerRef}>
      {groupBlocks(prepared.blocks).map((group) => group.callout ?
        <section key={group.key} className={group.kind ? `md-callout md-callout--${group.kind}` : 'md-callout'}>
          {group.blocks.map(renderBlock)}
        </section> : renderBlock(group.block))}
      {comments.length > 0 && <section className="translated-discussions"><h2>{t('comments')}</h2>
        {comments.map((comment, index) => <div key={index} className="rail-comment">
          {comment.author && <span className="rail-author">@{comment.author}</span>}
          <CommentBody body={comment.body} />
        </div>)}
      </section>}
    </article>
  </>
}
