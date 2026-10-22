import type {
  BlockContent,
  DefinitionContent,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
} from 'mdast'
import { Fragment, type ReactNode, createElement, useMemo } from 'react'
import type { CriticCommentNode, CriticSubNode, CriticWrapNode } from '../../../document/markdown/critic-mdast'
import { highlight } from './highlight'
import { toggleTaskEdit } from '../../../document/markdown/tasklist'
import type { TextEdit } from '../../../document/types'
import type { Analysis } from '../../../document/markdown/analyze'
import { DiamondIcon } from '../../icons'
import { Frontmatter } from './Frontmatter'
import { TableViewport } from './TableViewport'
import { plainText } from './outline'
import { calloutKind, calloutSections } from './callouts'

interface RenderCtx {
  source: string
  /** Absent → interactive affordances (task checkboxes) are disabled. */
  onEdit?: (edit: TextEdit) => void
  highlightCode?: boolean
  /** Localized labels for the deletion-undo affordance. When present, a deletion
   *  mark becomes a tabbable button announcing that activating it removes the
   *  suggestion; absent (e.g. the translated view), the mark stays inert. */
  markLabels?: { deletion: string; hint: string }
}

interface PresentedCtx extends RenderCtx {
  anchoredHighlights?: ReadonlySet<number>
  commentMarkers?: ReadonlySet<number>
}

function deletionProps(
  ctx: PresentedCtx,
  text: string,
): { tabIndex: 0; role: 'button'; 'aria-label': string } | Record<string, never> {
  if (!ctx.markLabels) return {}
  const body = text.replace(/[.\s]+$/, '')
  return { tabIndex: 0, role: 'button', 'aria-label': `${ctx.markLabels.deletion}: ${body}. ${ctx.markLabels.hint}` }
}

function codeChildren(value: string, lang: string | undefined): ReactNode[] {
  return highlight(value, lang).map((tok, i) =>
    tok.type === 'text' ? tok.value : (
      <span key={i} className={`tok tok-${tok.type}`}>
        {tok.value}
      </span>
    ),
  )
}

function renderCritic(node: { type: string }, key: number, ctx: PresentedCtx): ReactNode | undefined {
  switch (node.type) {
    case 'criticInsert': {
      const n = node as CriticWrapNode
      return (
        <ins key={key} className="critic critic-ins" data-span-index={n.data.spanIndex}>
          {renderInline(n.children, ctx)}
        </ins>
      )
    }
    case 'criticDelete': {
      const n = node as CriticWrapNode
      return (
        <del
          key={key}
          className="critic critic-del"
          data-span-index={n.data.spanIndex}
          {...deletionProps(ctx, plainText(n))}
        >
          {renderInline(n.children, ctx)}
        </del>
      )
    }
    case 'criticHighlight': {
      const n = node as CriticWrapNode
      // A highlight is only a visual when it anchors a comment thread; a standalone
      // highlight renders as plain text (the Highlight verb was retired).
      if (!ctx.anchoredHighlights?.has(n.data.spanIndex)) {
        return <Fragment key={key}>{renderInline(n.children, ctx)}</Fragment>
      }
      return (
        <mark
          key={key}
          className="critic critic-hl critic-anchor"
          data-span-index={n.data.spanIndex}
          role="button"
          tabIndex={0}
        >
          {renderInline(n.children, ctx)}
        </mark>
      )
    }
    case 'criticSub': {
      const n = node as CriticSubNode
      return (
        <span key={key} className="critic critic-sub" data-span-index={n.data.spanIndex}>
          <del>{n.data.old}</del>
          <span className="critic-sub-arrow" aria-hidden>
            →
          </span>
          <ins>{n.data.new}</ins>
        </span>
      )
    }
    case 'criticComment': {
      const n = node as CriticCommentNode
      return (
        <span
          key={key}
          className={`critic ${ctx.commentMarkers?.has(n.data.spanIndex) ? 'critic-comment-marker' : 'critic-comment-reference'}`}
          data-span-index={n.data.spanIndex}
          title={n.data.content}
          role="button"
          tabIndex={0}
          aria-label={n.data.content}
        >
          <DiamondIcon />
        </span>
      )
    }
    default:
      return undefined
  }
}

type Positioned = { position?: { start?: { offset?: number }; end?: { offset?: number } } }

function posAttrs(node: Positioned): Record<string, number> {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  return start !== undefined && end !== undefined ? { 'data-ps': start, 'data-pe': end } : {}
}

function renderInline(nodes: readonly PhrasingContent[], ctx: PresentedCtx): ReactNode[] {
  return nodes.map((node, i) => renderPhrasing(node, i, ctx))
}

function renderPhrasing(node: PhrasingContent, key: number, ctx: PresentedCtx): ReactNode {
  const critic = renderCritic(node, key, ctx)
  if (critic !== undefined) return critic
  switch (node.type) {
    case 'text':
      return (
        <span key={key} {...posAttrs(node)}>
          {node.value}
        </span>
      )
    case 'emphasis':
      return (
        <em key={key} {...posAttrs(node)}>
          {renderInline(node.children, ctx)}
        </em>
      )
    case 'strong':
      return (
        <strong key={key} {...posAttrs(node)}>
          {renderInline(node.children, ctx)}
        </strong>
      )
    case 'delete':
      return (
        <del key={key} {...posAttrs(node)}>
          {renderInline(node.children, ctx)}
        </del>
      )
    case 'inlineCode':
      return (
        <code key={key} className="md-inline-code" {...posAttrs(node)}>
          {node.value}
        </code>
      )
    case 'link':
      return (
        <a key={key} href={node.url} title={node.title ?? undefined} target="_blank" rel="noreferrer" {...posAttrs(node)}>
          {renderInline(node.children, ctx)}
        </a>
      )
    case 'image':
      return (
        <img
          key={key}
          src={node.url}
          alt={node.alt ?? ''}
          title={node.title ?? undefined}
          loading="lazy"
          decoding="async"
          {...posAttrs(node)}
        />
      )
    case 'break':
      return <br key={key} />
    case 'footnoteReference':
      return (
        <sup key={key} className="md-footnote-ref">
          [{node.identifier}]
        </sup>
      )
    case 'linkReference':
      return <Fragment key={key}>{renderInline(node.children, ctx)}</Fragment>
    case 'imageReference':
      return (
        <span key={key} className="md-muted">
          [image: {node.alt ?? node.identifier}]
        </span>
      )
    case 'html':
      return node.value.startsWith('<!--') ? null : (
        <code key={key} className="md-inline-code">
          {node.value}
        </code>
      )
    default:
      return null
  }
}

function renderListItem(item: ListItem, key: number, ctx: PresentedCtx, tight: boolean): ReactNode {
  const isTask = typeof item.checked === 'boolean'
  const checkbox = isTask ? (
    <input
      type="checkbox"
      className="task-checkbox"
      checked={item.checked ?? false}
      disabled={!ctx.onEdit}
      onChange={() => {
        const start = item.position?.start?.offset
        if (start === undefined || !ctx.onEdit) return
        const edit = toggleTaskEdit(ctx.source, start)
        if (edit) ctx.onEdit(edit)
      }}
    />
  ) : null

  const children = item.children.map((child, i) => {
    if (child.type === 'paragraph' && (tight || (isTask && i === 0))) {
      return <Fragment key={i}>{renderInline(child.children, ctx)}</Fragment>
    }
    return renderBlock(child, i, ctx)
  })

  return (
    <li key={key} className={isTask ? 'task-item' : undefined} {...posAttrs(item)}>
      {checkbox}
      {children}
    </li>
  )
}

function renderList(node: List, key: number, ctx: PresentedCtx): ReactNode {
  const tight = node.spread !== true
  const items = node.children.map((item, i) => renderListItem(item, i, ctx, tight))
  return node.ordered ? (
    <ol key={key} start={node.start ?? undefined} {...posAttrs(node)}>
      {items}
    </ol>
  ) : (
    <ul key={key} {...posAttrs(node)}>
      {items}
    </ul>
  )
}

function renderBlock(node: BlockContent | DefinitionContent | RootContent, key: number, ctx: PresentedCtx): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return (
        <p key={key} {...posAttrs(node)}>
          {renderInline(node.children, ctx)}
        </p>
      )
    case 'heading':
      return createElement(
        `h${node.depth}`,
        { key, ...posAttrs(node) },
        renderInline(node.children, ctx),
      )
    case 'blockquote':
      return (
        <blockquote key={key} {...posAttrs(node)}>
          {node.children.map((child, i) => renderBlock(child, i, ctx))}
        </blockquote>
      )
    case 'list':
      return renderList(node, key, ctx)
    case 'yaml':
      return <Frontmatter key={key} source={node.value} />
    case 'code':
      return (
        <pre key={key} className="md-code" data-lang={node.lang ?? undefined} {...posAttrs(node)}>
          <code>{ctx.highlightCode ? codeChildren(node.value, node.lang ?? undefined) : node.value}</code>
        </pre>
      )
    case 'table': {
      const [head, ...rows] = node.children
      const align = node.align ?? []
      const cellStyle = (i: number) => {
        const a = align[i]
        return a ? { textAlign: a } : undefined
      }
      return (
        <TableViewport key={key} contentKey={ctx.source}><table {...posAttrs(node)}>
          {head && (
            <thead>
              <tr>
                {head.children.map((cell, i) => (
                  <th key={i} style={cellStyle(i)} {...posAttrs(cell)}>
                    {renderInline(cell.children, ctx)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.children.map((cell, ci) => (
                  <td key={ci} style={cellStyle(ci)} {...posAttrs(cell)}>
                    {renderInline(cell.children, ctx)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table></TableViewport>
      )
    }
    case 'thematicBreak':
      return <hr key={key} />
    case 'html':
      // HTML comments carry hidden history; other raw HTML remains inert text.
      return node.value.trimStart().startsWith('<!--') ? null : (
        <pre key={key} className="md-code md-html" {...posAttrs(node)}>
          <code>{node.value}</code>
        </pre>
      )
    case 'footnoteDefinition':
      return (
        <div key={key} className="md-footnote-def" {...posAttrs(node)}>
          <sup>[{node.identifier}]</sup>{' '}
          {node.children.map((child, i) => renderBlock(child, i, ctx))}
        </div>
      )
    case 'definition':
      return null
    default:
      if ('children' in node && Array.isArray(node.children)) {
        return <Fragment key={key}>{renderInline(node.children as PhrasingContent[], ctx)}</Fragment>
      }
      return null
  }
}

export function MarkdownView({ analysis, ctx }: { analysis: Pick<Analysis, 'tree' | 'threads'>; ctx: RenderCtx }) {
  const presentation = useMemo(() => {
    const anchoredHighlights = new Set<number>()
    const commentMarkers = new Set<number>()
    for (const card of analysis.threads) (card.thread.anchor ? anchoredHighlights : commentMarkers).add(card.spanIndex)
    return { anchoredHighlights, commentMarkers }
  }, [analysis.threads])
  const presented = { ...ctx, ...presentation }
  const sections = calloutSections(analysis.tree.children, (node) => node.type === 'heading' ? node.depth : null,
    (node) => calloutKind(plainText(node)))
  // Leave a callout's wrapper unpositioned so review selections anchor to its inner blocks.
  return <>{sections.map((section) => section.kind
    ? <section key={section.start} className={`md-callout md-callout--${section.kind}`}>
      {section.items.map((b, bi) => renderBlock(b, bi, presented))}
    </section>
    : renderBlock(section.items[0], section.start, presented))}</>
}
