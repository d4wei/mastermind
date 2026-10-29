import { useEffect, useMemo, useState, type Ref } from 'react'
import type { Node } from 'unist'
import { prepareTranslation, type TranslationBlock, type PreparedTranslation } from '../../document/translation'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import { useT } from '../i18n'
import { MarkdownView } from '../modes/reading/Renderer'
import { calloutKind, calloutSections, type CalloutKind } from '../modes/reading/callouts'
import { useConfig } from '../app/configStore'
import { CommentBody } from '../review/CommentBody'

/** Callout structure follows source headings so translated headings cannot change grouping. */
function sourceHeading(block: TranslationBlock): { depth: number; kind: CalloutKind | null } | null {
  if (block.kind !== 'heading') return null
  const m = block.text.match(/^(#{1,6})\s+([^\n]*)/)
  if (!m) return null
  return { depth: m[1]!.length, kind: calloutKind(m[2]!) }
}

interface Props {
  source: string
  artifact: PreparedTranslation
  containerRef: Ref<HTMLElement>
}

/**
 * Offsets inside a block index its displayed text; a copy without them keeps them from posing as
 * document offsets. The copy leaves the analysis's own trees, which may be one object, intact.
 */
function withoutPositions<T extends Node>(node: T): T {
  const { position: _, ...rest } = node
  return 'children' in node && Array.isArray(node.children)
    ? { ...rest, children: node.children.map(withoutPositions) } as unknown as T
    : rest as T
}

function TransBlock({ block, translated }: { block: TranslationBlock; translated?: string }) {
  const highlightCode = (useConfig((state) => state.config?.codeTheme) ?? 'none') !== 'none'
  const shown = translated ?? block.text
  const analysis = useMemo(() => {
    const result = analyzeMarkdown(shown)
    return { ...result, tree: withoutPositions(result.tree) }
  }, [shown])
  // A heading block carries its source offset so outline navigation finds it as in the original.
  return <div className="trans-block" data-ps={block.kind === 'heading' ? block.start : undefined}>
    <div className="trans-block-body md-root" data-trans-block-id={block.translatable ? block.id : undefined}>
      <MarkdownView analysis={analysis} ctx={{ source: shown, highlightCode }} />
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
  const comments = useMemo(() => analyzeMarkdown(source).items.flatMap((item) => item.type === 'thread' ? item.comments : []),
    [source])
  if (!prepared || prepared.source !== source) return null
  const map = new Map(artifact.blocks.map((block) => [block.id, block.text]))
  const renderBlock = (block: TranslationBlock) => <TransBlock key={block.id} block={block}
    translated={block.translatable ? map.get(block.id) : undefined} />
  return <>
    <article className="trans-view" ref={containerRef}>
      {calloutSections(prepared.blocks, (block) => sourceHeading(block)?.depth ?? null,
        (block) => sourceHeading(block)!.kind).map((section) => section.kind ?
        <section key={`${section.items[0]!.id}-${section.items[0]!.start}`} className={`md-callout md-callout--${section.kind}`}>
          {section.items.map(renderBlock)}
        </section> : renderBlock(section.items[0]))}
      {comments.length > 0 && <section className="translated-discussions"><h2>{t('comments')}</h2>
        {comments.map((comment, index) => <div key={index} className="rail-comment">
          {comment.author && <span className="rail-author">@{comment.author}</span>}
          <CommentBody body={comment.body} />
        </div>)}
      </section>}
    </article>
  </>
}
