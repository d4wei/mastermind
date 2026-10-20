import { useTableExpansion } from '../modes/reading/TableExpansion'
import { useDraftGuard, useDraftState } from './drafts'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { DropdownMenu } from 'radix-ui'
import { useT } from '../i18n'
import { CommentBody } from './CommentBody'
import { CheckIcon, ChevronUpIcon, MoreIcon } from '../icons'
import { deleteCommentEdits, resolveThreadEdits } from '../../document/review-archive'
import './ResolvedThreads.css'
import { useCompositionGuard } from '../util/composition'
import { revealElement } from '../util/scroll'
import { placeCommentCards } from './rail-layout'
import type { CriticSpan, ReviewItem } from '../../document/critic/types'
import type { TextEdit } from '../../document/types'

type ThreadItem = Extract<ReviewItem, { type: 'thread' }>

interface Props {
  readOnly?: boolean
  items: readonly ReviewItem[]
  spans: readonly CriticSpan[]
  source: string
  docRef: RefObject<HTMLElement | null>
  authorTag: string
  activeSpan: number | null
  replyRequest?: { spanIndex: number } | null
  onReplyHandled?: () => void
  hoveredSpan?: number | null
  onHover?: (spanIndex: number | null) => void
  onActivate: (spanIndex: number | null) => void
  onEdit: (edits: TextEdit[]) => void
}

const CARD_GAP = 8

/** Appending replies must not discard a draft or remount the discussion. */
function threadKey(thread: ThreadItem, anchorText: string): string {
  const first = thread.comments[0]
  return JSON.stringify([anchorText, first?.author ?? '', first?.body])
}

export function CommentRail({ items, spans, source, docRef, authorTag, activeSpan, hoveredSpan,
  onHover, onActivate, onEdit, replyRequest, onReplyHandled, readOnly = false }: Props) {
  const { hidden: tableExpanded } = useTableExpansion()
  const t = useT()
  const ime = useCompositionGuard()
  const railRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const [positions, setPositions] = useState<number[]>([])
  const [railHeight, setRailHeight] = useState(0)
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const [drafts, setDrafts] = useDraftState<Record<string, string>>('replies', {})
  const [resolveError, setResolveError] = useState<string | null>(null)
  const activatedFromCard = useRef<number | null>(null)
  const selectedKey = useRef<string | null>(null)
  const cards = useMemo(() => {
    const seen = new Map<string, number>()
    return items.filter((item): item is ThreadItem => item.type === 'thread').map((thread) => {
      const anchorSpan = thread.anchor ?? thread.comments[0]!.span
      const anchorText = thread.anchor ? source.slice(thread.anchor.innerStart, thread.anchor.innerEnd) : ''
      const key = threadKey(thread, anchorText)
      const duplicate = seen.get(key) ?? 0
      seen.set(key, duplicate + 1)
      return { key: `${key}#${duplicate}`, spanIndex: spans.indexOf(anchorSpan), anchorText, thread }
    })
  }, [items, spans, source])

  useLayoutEffect(() => {
    const rail = railRef.current
    const doc = docRef.current
    if (!doc || !rail) return
    const measure = () => {
      const railTop = rail.getBoundingClientRect().top
      const measurements = cards.map((card) => ({
        anchorTop: Math.max(0, (doc.querySelector(`[data-span-index="${card.spanIndex}"]`)
          ?.getBoundingClientRect().top ?? railTop) - railTop),
        height: cardRefs.current.get(card.key)?.offsetHeight ?? 0,
      }))
      const next = placeCommentCards(measurements, cards.findIndex((card) => card.spanIndex === activeSpan), CARD_GAP)
      setPositions((current) => current.length === next.length && current.every((top, i) => top === next[i]) ? current : next)
      setRailHeight(Math.max(doc.scrollHeight, ...next.map((top, i) => top + measurements[i]!.height)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(doc)
    cardRefs.current.forEach((element) => observer.observe(element))
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [cards, activeSpan, replyFor, docRef])

  useEffect(() => {
    if (activeSpan === null) {
      selectedKey.current = null
      activatedFromCard.current = null
      setReplyFor(null)
      return
    }
    const card = cards.find((item) => item.spanIndex === activeSpan)
    if (!card || selectedKey.current === card.key) return
    selectedKey.current = card.key
    if (activatedFromCard.current === activeSpan) { activatedFromCard.current = null; return }
    const element = cardRefs.current.get(card.key)
    if (!element) return
    const frame = requestAnimationFrame(() => {
      const target = element.querySelector('textarea') ?? element.querySelector('.rail-message-header') ?? element
      // Narrow panels own their scroll surface; wide cards share document scrolling.
      if (element.closest('.comments-panel')) target.scrollIntoView({ block: 'nearest' })
      else revealElement(target)
    })
    return () => cancelAnimationFrame(frame)
  }, [activeSpan, cards])

  const focusReply = useCallback((key: string) => {
    if (readOnly) return
    setReplyFor(key)
    // An already-open composer does not remount, so autofocus cannot handle repeat clicks.
    cardRefs.current.get(key)?.querySelector('textarea')?.focus({ preventScroll: true })
  }, [readOnly])
  useEffect(() => {
    if (!replyRequest) return
    const card = cards.find((item) => item.spanIndex === replyRequest.spanIndex)
    if (card) focusReply(card.key)
    onReplyHandled?.()
  }, [replyRequest, onReplyHandled, cards, focusReply])

  const activate = (spanIndex: number) => {
    activatedFromCard.current = spanIndex
    onActivate(spanIndex)
    const card = cards.find((item) => item.spanIndex === spanIndex)
    if (card) focusReply(card.key)
    revealElement(docRef.current?.querySelector(`[data-span-index="${spanIndex}"]`) ?? null, true)
  }
  const collapse = () => {
    const card = cards.find((item) => item.spanIndex === activeSpan)
    const element = card && cardRefs.current.get(card.key)
    if (element?.contains(document.activeElement)) element.querySelector<HTMLButtonElement>('.rail-select')?.focus({ preventScroll: true })
    setReplyFor(null)
    onActivate(null)
  }
  const resolveThread = (thread: ThreadItem) => {
    if (readOnly) return
    let edits: TextEdit[]
    try { edits = resolveThreadEdits(source, thread) }
    catch (error) { setResolveError(error instanceof Error ? error.message : String(error)); return }
    if (!edits.length) return
    onHover?.(null)
    onEdit(edits)
    setResolveError(null)
    collapse()
  }
  const submitReply = (card: typeof cards[number]) => {
    const text = drafts[card.key]?.trim()
    if (readOnly || !text) return
    const body = text.replace(/\n[ \t]*\n+/g, '\n').replaceAll('<<}', '<< }')
    onEdit([{ from: card.thread.end, to: card.thread.end, insert: `{>>@${authorTag}: ${body}<<}` }])
    setReplyFor(null)
    setDrafts((current) => { const next = { ...current }; delete next[card.key]; return next })
  }

  useDraftGuard('replies', t('reply'), Object.values(drafts).some((text) => !!text.trim()), () => {
    const card = cards.find((item) => drafts[item.key]?.trim())
    if (!card) {
      requestAnimationFrame(() => {
        const input = railRef.current?.querySelector<HTMLTextAreaElement>('.rail-orphan textarea')
        input?.focus(); input?.scrollIntoView({ block: 'nearest' })
      })
      return
    }
    onActivate(card.spanIndex)
    setReplyFor(card.key)
    requestAnimationFrame(() => {
      const input = cardRefs.current.get(card.key)?.querySelector('textarea')
      input?.focus(); input?.scrollIntoView({ block: 'nearest' })
    })
  }, () => { setDrafts({}); setReplyFor(null) })

  const orphaned = Object.entries(drafts).filter(([key, text]) => text.trim() && !cards.some((card) => card.key === key))
  if (!cards.length && !orphaned.length) return null
  return <div ref={railRef} className="rail" inert={tableExpanded} aria-hidden={tableExpanded || undefined} data-table-hidden={tableExpanded} style={{ height: railHeight || undefined }}>
    {resolveError && <div className="rail-resolution-error" role="alert">{t('resolveFailed')}: {resolveError}</div>}
    {cards.map((card, index) => {
      const selected = activeSpan === card.spanIndex
      const replies = card.thread.comments.length - 1
      const replyCount = t(replies === 1 ? 'countReply' : 'countReplies').replace('{count}', String(replies))
      return <div key={card.key} role="group" aria-label={t('resolvedOriginal')}
        ref={(element) => { if (element) cardRefs.current.set(card.key, element); else cardRefs.current.delete(card.key) }}
        className={`rail-card${selected ? ' active' : ''}${hoveredSpan === card.spanIndex ? ' paired' : ''}`}
        style={{ top: positions[index] ?? 0 }}
        onPointerEnter={() => onHover?.(card.spanIndex)} onPointerLeave={() => onHover?.(null)}
        onFocus={() => onHover?.(card.spanIndex)}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover?.(null) }}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [role="menuitem"]')) return
          if (window.getSelection()?.isCollapsed !== false) activate(card.spanIndex)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !ime.isComposing(event.nativeEvent) && !(event.target as HTMLElement).closest('[role="menu"]')) {
            event.stopPropagation()
            collapse()
          }
        }}>
        {(selected ? card.thread.comments : card.thread.comments.slice(0, 1)).map((comment, messageIndex) =>
          <div key={messageIndex} data-find-comment={spans.indexOf(comment.span)} className={`rail-comment${messageIndex ? ' rail-comment-reply' : ''}`}>
            <div className="rail-message-header">
              {messageIndex === 0 ? <button type="button" className="rail-select" aria-expanded={selected}
                aria-label={`${t('resolvedOriginal')}: ${comment.author ?? t('comment')}`}
                onClick={() => activate(card.spanIndex)}>
                <span className="rail-author">{comment.author ?? t('comment')}</span>
              </button> : <span className="rail-author">{comment.author ?? t('comment')}</span>}
              {messageIndex === 0 && <>
                <button type="button" className="btn-ghost btn-icon rail-icon" aria-label={t('resolve')} title={t('resolve')}
                  disabled={readOnly} onClick={() => resolveThread(card.thread)}><CheckIcon /></button>
                {selected && <button type="button" className="btn-ghost btn-icon rail-icon" aria-label={t('collapseDiscussion')}
                  title={t('collapseDiscussion')} onClick={collapse}><ChevronUpIcon /></button>}
              </>}
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild><button type="button" className="btn-ghost btn-icon rail-icon"
                  aria-label={t('moreActions')} title={t('moreActions')}><MoreIcon /></button></DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="reader-menu" align="end" sideOffset={4}>
                    <DropdownMenu.Item className="reader-menu-item" disabled={readOnly} onSelect={() => {
                      if (readOnly) return
                      onHover?.(null)
                      onEdit(deleteCommentEdits(source, card.thread, messageIndex))
                      collapse()
                    }}>{t('deleteComment')}</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            {messageIndex === 0 && card.anchorText && <div className="rail-card-anchor" title={card.anchorText}>{card.anchorText}</div>}
            <CommentBody body={comment.body} />
          </div>)}
        {selected && replyFor === card.key ? <div className="rail-reply">
          {readOnly && <p role="status">{t('editingPaused')}</p>}
          <textarea autoFocus readOnly={readOnly} ref={ime.textareaRef} rows={2}
            onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd} onBlur={ime.onBlur}
            value={drafts[card.key] ?? ''} placeholder={t('replyPlaceholder')} aria-label={t('replyPlaceholder')}
            onChange={(event) => setDrafts((current) => ({ ...current, [card.key]: event.target.value }))}
            onKeyDown={(event) => {
              if (ime.isComposing(event.nativeEvent)) { event.stopPropagation(); return }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submitReply(card) }
              if (event.key === 'Escape') { event.stopPropagation(); collapse() }
            }} />
          <div className="rail-actions">
            <button type="button" onClick={() => setReplyFor(null)}>{t('cancel')}</button>
            <button type="button" className="btn-primary btn-compact" disabled={readOnly || !drafts[card.key]?.trim()}
              onClick={() => submitReply(card)}>{t('reply')}</button>
          </div>
        </div> : <div className="rail-actions rail-footer">
          {!selected && replies > 0 && <button type="button" aria-expanded={false}
            onClick={() => activate(card.spanIndex)}>{replyCount}</button>}
          {(selected || replies === 0) && <button type="button" disabled={readOnly} onClick={() => {
            activate(card.spanIndex)
          }}>{t('reply')}</button>}
        </div>}
      </div>
    })}
    {orphaned.length > 0 && <div className="rail-orphan" style={{ paddingTop: cards.length ? railHeight : undefined }}>
      <p>{t('draftTargetChanged')}</p>
      {orphaned.map(([key, text]) => <label key={key}>{t('reply')}
        <textarea readOnly value={text} />
      </label>)}
    </div>}
  </div>
}
