import { useTableExpansion } from '../modes/reading/TableExpansion'
import { replyEdits } from '../modes/reading/marks'
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
import { locateThread, rebaseThread, threadCards, threadRef, type ThreadCard, type ThreadRef } from './thread-identity'
import type { CriticSpan, ReviewItem } from '../../document/critic/types'
import type { TextEdit } from '../../document/types'

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

/** An unsent reply; `thread` becomes null once its discussion no longer exists. */
interface ReplyDraft { id: number; thread: ThreadRef | null; text: string }

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
  const [drafts, setDrafts] = useDraftState<ReplyDraft[]>('replies', [])
  const [resolveError, setResolveError] = useState<string | null>(null)
  const activatedFromCard = useRef<number | null>(null)
  const selectedKey = useRef<string | null>(null)
  const cards = useMemo(() => threadCards(items, spans, source), [items, spans, source])
  // Each draft follows its discussion's identity and position, never its ordinal among duplicates.
  const placedDrafts = useMemo(() => {
    const byCard = new Map<string, ReplyDraft>()
    const cardOf = new Map<number, ThreadCard>()
    for (const draft of drafts) {
      const card = draft.thread && locateThread(draft.thread, source, cards)
      if (card && !byCard.has(card.key)) { byCard.set(card.key, draft); cardOf.set(draft.id, card) }
    }
    return { byCard, cardOf }
  }, [drafts, cards, source])
  useEffect(() => {
    if (!drafts.some((draft) => draft.thread && draft.thread.source !== source)) return
    setDrafts((current) => current.flatMap((draft) => {
      if (!draft.thread || draft.thread.source === source) return [draft]
      const card = placedDrafts.cardOf.get(draft.id)
      return card || draft.text.trim() ? [{ ...draft, thread: card ? threadRef(card, source) : null }] : []
    }))
  }, [drafts, source, placedDrafts, setDrafts])
  const draftText = (card: ThreadCard) => placedDrafts.byCard.get(card.key)?.text ?? ''
  const setDraftText = (card: ThreadCard, text: string) => {
    const existing = placedDrafts.byCard.get(card.key)
    setDrafts((current) => existing
      ? current.map((draft) => draft.id === existing.id ? { ...draft, text } : draft)
      : [...current, { id: Math.max(0, ...current.map((draft) => draft.id)) + 1, thread: threadRef(card, source), text }])
  }
  const removeDraft = (id: number | undefined) => setDrafts((current) => current.filter((draft) => draft.id !== id))
  /** Applies rail edits; drafts of other discussions follow them exactly, and `ended` loses its draft. */
  const edit = (edits: TextEdit[], ended?: ThreadCard) => {
    const removed = ended && placedDrafts.byCard.get(ended.key)?.id
    onEdit(edits)
    setDrafts((current) => current.filter((draft) => draft.id !== removed)
      .map((draft) => draft.thread ? { ...draft, thread: rebaseThread(draft.thread, source, edits) } : draft))
  }

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
  const resolveThread = (card: ThreadCard) => {
    if (readOnly) return
    let edits: TextEdit[]
    try { edits = resolveThreadEdits(source, card.thread) }
    catch (error) { setResolveError(error instanceof Error ? error.message : String(error)); return }
    if (!edits.length) return
    onHover?.(null)
    edit(edits, card)
    setResolveError(null)
    collapse()
  }
  // Null marks a reply whose insert would not reparse as one comment in place; it stays editable
  // but cannot submit.
  const pendingReply = (card: ThreadCard): TextEdit[] | null => {
    const text = draftText(card)
    return readOnly || !text.trim() ? null : replyEdits(source, card.thread.end, authorTag, text)
  }
  const submitReply = (card: ThreadCard) => {
    const edits = pendingReply(card)
    if (!edits) return
    edit(edits, card)
    setReplyFor(null)
  }

  useDraftGuard('replies', t('reply'), drafts.some((draft) => !!draft.text.trim()), () => {
    const card = cards.find((item) => draftText(item).trim())
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
  }, () => { setDrafts([]); setReplyFor(null) })

  const orphaned = drafts.filter((draft) => draft.text.trim() && !placedDrafts.cardOf.has(draft.id))
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
                  disabled={readOnly} onClick={() => resolveThread(card)}><CheckIcon /></button>
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
                      // Deleting the opening message ends the discussion's identity.
                      edit(deleteCommentEdits(source, card.thread, messageIndex), messageIndex === 0 ? card : undefined)
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
          <textarea autoFocus readOnly={readOnly} ref={ime.ref} rows={2}
            onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd} onBlur={ime.onBlur}
            value={draftText(card)} placeholder={t('replyPlaceholder')} aria-label={t('replyPlaceholder')}
            onChange={(event) => setDraftText(card, event.target.value)}
            onKeyDown={(event) => {
              if (ime.isComposing(event.nativeEvent)) { event.stopPropagation(); return }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submitReply(card) }
              if (event.key === 'Escape') { event.stopPropagation(); collapse() }
            }} />
          <div className="rail-actions">
            <button type="button" onClick={() => setReplyFor(null)}>{t('cancel')}</button>
            <button type="button" className="btn-primary btn-compact" disabled={!pendingReply(card)}
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
      {orphaned.map((draft) => <div key={draft.id}>
        <label>{t('reply')}<textarea readOnly value={draft.text} /></label>
        <div className="rail-actions">
          <button type="button" onClick={() => removeDraft(draft.id)}>{t('discardDraft')}</button>
        </div>
      </div>)}
    </div>}
  </div>
}
