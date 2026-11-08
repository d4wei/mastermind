import { useTableExpansion } from '../modes/reading/TableExpansion'
import { commentBodyFits, replyEdits } from '../modes/reading/marks'
import { useDraftGuard } from './drafts'
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject,
  type SetStateAction } from 'react'
import { useT } from '../i18n'
import { RepliesDisclosure } from './RepliesDisclosure'
import { ThreadMessage } from './ThreadMessage'
import { QuotedPassage } from './QuotedPassage'
import { Collapsible } from './Collapsible'
import { CheckIcon } from '../icons'
import { DiscussionMenu } from './DiscussionMenu'
import { deleteCommentEdits, resolveThreadEdits } from '../../document/review-archive'
import './ResolvedThreads.css'
import { useCompositionGuard } from '../util/composition'
import { revealElement } from '../util/scroll'
import { RailPlacement } from './rail-layout'
import { locateThread, threadRef, type ReplyDraft } from './thread-identity'
import type { ThreadCard } from '../../document/critic/types'
import type { Analysis } from '../../document/markdown/analyze'
import type { TextEdit } from '../../document/types'

interface Props {
  readOnly?: boolean
  analysis: Pick<Analysis, 'plain' | 'spans' | 'threads' | 'tree' | 'provenance'>
  /** The source `analysis` describes. */
  source: string
  docRef: RefObject<HTMLElement | null>
  authorTag: string
  activeSpan: number | null
  replyRequest?: { spanIndex: number } | null
  onReplyHandled?: () => void
  /** The discussion under the pointer; it and `focusedSpan` are emphasized without selecting. */
  hoveredSpan?: number | null
  /** The discussion whose card holds keyboard focus. */
  focusedSpan?: number | null
  onHover?: (spanIndex: number | null) => void
  onFocusSpan?: (spanIndex: number | null) => void
  onActivate: (spanIndex: number | null) => void
  /** Returns whether the edits applied; the owner rebases `drafts` through those that did. */
  onEdit: (edits: TextEdit[]) => boolean
  /** Unsent replies; their owner outlives the rail and re-anchors them to each analysis. */
  drafts: readonly ReplyDraft[]
  onDraftsChange: (next: SetStateAction<ReplyDraft[]>) => void
  /** The rail is fading out after comments were hidden; it takes no input. */
  leaving?: boolean
}

const CARD_GAP = 8

/** What a card asks of its rail; one object for the rail's lifetime, so cards need not re-render for it. */
interface CardActions {
  activate: (spanIndex: number) => void
  /** Deselects the discussion; `keepFocus` leaves focus on a control that stays rendered. */
  collapse: (keepFocus?: boolean) => void
  resolve: (card: ThreadCard) => void
  deleteMessage: (card: ThreadCard, messageIndex: number) => void
  setDraft: (card: ThreadCard, text: string) => void
  submit: (card: ThreadCard) => void
  /** Discards the card's draft and collapses it. */
  cancel: (card: ThreadCard) => void
  hover: (spanIndex: number | null) => void
  focusSpan: (spanIndex: number | null) => void
}

export function CommentRail({ analysis, source, docRef, authorTag, activeSpan, hoveredSpan, focusedSpan, onHover,
  onFocusSpan, onActivate, onEdit, drafts, onDraftsChange: setDrafts, replyRequest, onReplyHandled, readOnly = false, leaving = false }: Props) {
  const cards = analysis.threads
  const { hidden: tableExpanded } = useTableExpansion()
  const t = useT()
  const railRef = useRef<HTMLDivElement | null>(null)
  const [placed, setPlaced] = useState<ReadonlySet<string>>(() => new Set())
  const [placement] = useState(() => new RailPlacement(CARD_GAP, (keys) => setPlaced(new Set(keys))))
  const attachRail = useCallback((element: HTMLDivElement | null) => {
    railRef.current = element
    placement.setRail(element)
  }, [placement])
  const attachDrafts = useCallback((element: HTMLDivElement | null) => placement.setDrafts(element), [placement])
  // Stable per card, so a render neither releases nor re-observes a card that stays.
  const cardRefs = useRef(new Map<string, (element: HTMLDivElement | null) => (() => void) | undefined>())
  const cardRef = (key: string) => {
    let ref = cardRefs.current.get(key)
    if (!ref) cardRefs.current.set(key, ref = (element) => element ? placement.attach(key, element) : undefined)
    return ref
  }
  // The card whose reply composer was explicitly requested and takes focus; the selected card shows
  // its composer either way.
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const activatedFromCard = useRef<number | null>(null)
  /** A requested composer that could not take focus yet, because it was still collapsing. */
  const pendingFocus = useRef<string | null>(null)
  const selectedKey = useRef<string | null>(null)
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
  const draftText = (card: ThreadCard) => placedDrafts.byCard.get(card.key)?.text ?? ''
  const setDraftText = (card: ThreadCard, text: string) => {
    const existing = placedDrafts.byCard.get(card.key)
    setDrafts((current) => existing
      ? current.map((draft) => draft.id === existing.id ? { ...draft, text } : draft)
      : [...current, { id: Math.max(0, ...current.map((draft) => draft.id)) + 1,
        thread: threadRef(card, source, cards), text }])
  }
  const removeDraft = (id: number | undefined) => setDrafts((current) => current.filter((draft) => draft.id !== id))
  /** Applies rail edits; once they apply, `ended` loses its draft. Returns whether they applied. */
  const edit = (edits: TextEdit[], ended?: ThreadCard): boolean => {
    const removed = ended && placedDrafts.byCard.get(ended.key)?.id
    if (!onEdit(edits)) return false
    if (removed !== undefined) removeDraft(removed)
    return true
  }

  useLayoutEffect(() => {
    placement.connect()
    return () => placement.disconnect()
  }, [placement])
  useLayoutEffect(() => placement.update(docRef.current, cards, activeSpan), [placement, docRef, cards, activeSpan])
  useEffect(() => {
    for (const key of cardRefs.current.keys()) if (!cards.some((card) => card.key === key)) cardRefs.current.delete(key)
  }, [cards])

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
    const element = placement.element(card.key)
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
    // An already-open composer does not remount, so autofocus cannot handle repeat clicks; one that
    // is still collapsing stays inert until this request reopens it, so it takes focus after commit.
    const input = placement.element(key)?.querySelector('textarea')
    input?.focus({ preventScroll: true })
    pendingFocus.current = input && document.activeElement !== input ? key : null
  }, [readOnly])
  useLayoutEffect(() => {
    const key = pendingFocus.current
    if (key === null) return
    pendingFocus.current = null
    const input = placement.element(key)?.querySelector('textarea')
    if (input && !input.closest('[inert]')) input.focus({ preventScroll: true })
  })
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
  /** Deselects the discussion; `keepFocus` leaves focus on a control that stays rendered. */
  const collapse = (keepFocus = false) => {
    const card = cards.find((item) => item.spanIndex === activeSpan)
    const element = card && placement.element(card.key)
    if (!keepFocus && element?.contains(document.activeElement)) element.querySelector<HTMLButtonElement>('.rail-select')?.focus({ preventScroll: true })
    setReplyFor(null)
    onActivate(null)
  }
  const resolveThread = (card: ThreadCard) => {
    if (readOnly) return
    let edits: TextEdit[]
    try { edits = resolveThreadEdits(source, card.thread, analysis.plain) }
    catch (error) { setResolveError(error instanceof Error ? error.message : String(error)); return }
    if (!edits.length) return
    onHover?.(null)
    if (!edit(edits, card)) return
    setResolveError(null)
    collapse()
  }
  const deleteMessage = (card: ThreadCard, messageIndex: number) => {
    onHover?.(null)
    // Deleting the opening message ends the discussion's identity.
    const ended = messageIndex === 0 ? card : undefined
    if (edit(deleteCommentEdits(source, card.thread, messageIndex, analysis.plain), ended)) collapse()
  }
  // A paused document opens no new composer but keeps one that holds a draft or was already open.
  const composes = (card: ThreadCard) => card.spanIndex === activeSpan &&
    (!readOnly || replyFor === card.key || draftText(card) !== '')
  // The open composer's verdict checks only the edited blocks, follows its deferred text, and is
  // kept across renders that change neither. Submission verifies the final text in the whole
  // document; its refusal stands until the text or source changes. Null marks a reply whose insert
  // would not reparse as one comment in place: it stays editable but cannot submit.
  const composerCard = cards.find(composes)
  const composerText = useDeferredValue(composerCard ? draftText(composerCard) : '')
  const composerEnd = composerCard?.thread.end
  const composerVerified = useMemo(() => composerEnd === undefined || readOnly || !composerText.trim() ? null
    : replyEdits(source, composerEnd, authorTag, composerText, analysis, 'block'),
  [composerEnd, composerText, readOnly, source, authorTag, analysis])
  const [refusedReply, setRefusedReply] = useState<{ key: string; text: string; source: string } | null>(null)
  const canReply = !!composerVerified && !(refusedReply?.key === composerCard?.key &&
    refusedReply?.text === composerText && refusedReply?.source === source)
  // A body whose own lines break the mark says so.
  const bodyInvalid = !readOnly && !!composerText.trim() && !canReply && !commentBodyFits(authorTag, composerText)
  const submitReply = (card: ThreadCard) => {
    const text = draftText(card)
    if (readOnly || !text.trim()) return
    const edits = replyEdits(source, card.thread.end, authorTag, text, analysis)
    if (!edits) { setRefusedReply({ key: card.key, text, source }); return }
    if (!edit(edits, card)) return
    setReplyFor(null)
  }
  const cancel = (card: ThreadCard) => {
    removeDraft(placedDrafts.byCard.get(card.key)?.id)
    collapse()
  }

  const latest: CardActions = { activate, collapse, resolve: resolveThread, deleteMessage, setDraft: setDraftText,
    submit: submitReply, cancel, hover: (spanIndex) => onHover?.(spanIndex),
    focusSpan: (spanIndex) => onFocusSpan?.(spanIndex) }
  const handlers = useRef(latest)
  useLayoutEffect(() => { handlers.current = latest })
  const [actions] = useState<CardActions>(() => ({
    activate: (spanIndex) => handlers.current.activate(spanIndex),
    collapse: (keepFocus) => handlers.current.collapse(keepFocus),
    resolve: (card) => handlers.current.resolve(card),
    deleteMessage: (card, messageIndex) => handlers.current.deleteMessage(card, messageIndex),
    setDraft: (card, text) => handlers.current.setDraft(card, text),
    submit: (card) => handlers.current.submit(card),
    cancel: (card) => handlers.current.cancel(card),
    hover: (spanIndex) => handlers.current.hover(spanIndex),
    focusSpan: (spanIndex) => handlers.current.focusSpan(spanIndex),
  }))

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
      const input = placement.element(card.key)?.querySelector('textarea')
      input?.focus(); input?.scrollIntoView({ block: 'nearest' })
    })
  }, () => { setDrafts([]); setReplyFor(null) })

  const orphaned = drafts.filter((draft) => draft.text.trim() && !placedDrafts.cardOf.has(draft.id))
  if (!cards.length && !orphaned.length) return null
  return <div ref={attachRail} className={`rail${leaving ? ' leaving' : ''}`} inert={tableExpanded || leaving}
    aria-hidden={tableExpanded || leaving || undefined} data-table-hidden={tableExpanded}>
    {resolveError && <div className="rail-resolution-error" role="alert">{t('resolveFailed')}: {resolveError}</div>}
    {cards.map((card) => {
      const composer = card === composerCard
      return <RailCard key={card.key} card={card} attach={cardRef(card.key)} actions={actions} readOnly={readOnly}
        selected={activeSpan === card.spanIndex} placed={placed.has(card.key)}
        paired={hoveredSpan === card.spanIndex || focusedSpan === card.spanIndex}
        composes={composes(card)} requested={replyFor === card.key} draft={draftText(card)}
        canReply={composer && canReply} bodyInvalid={composer && bodyInvalid} />
    })}
    {orphaned.length > 0 && <div ref={attachDrafts} className="rail-orphan">
      <p>{t('draftTargetChanged')}</p>
      {orphaned.map((draft) => <div key={draft.id}>
        <label>{t('reply')}<textarea readOnly value={draft.text} /></label>
        <div className="rail-actions">
          <button type="button" className="rail-link" onClick={() => removeDraft(draft.id)}>{t('discardDraft')}</button>
        </div>
      </div>)}
    </div>}
  </div>
}

interface CardProps {
  card: ThreadCard
  /** Registers the card with placement; stable per card key. */
  attach: (element: HTMLDivElement | null) => (() => void) | undefined
  actions: CardActions
  readOnly: boolean
  selected: boolean
  /** Hovered or focused: emphasized with its passage, without selecting. */
  paired: boolean
  /** Placement has positioned the card; until then it stays unseen. */
  placed: boolean
  /** The reply composer shows. */
  composes: boolean
  /** The composer was explicitly requested and takes focus as it opens. */
  requested: boolean
  draft: string
  /** The open composer's verdict; a collapsing composer keeps its last open render. */
  canReply: boolean
  bodyInvalid: boolean
}

/**
 * One discussion card. It renders only when its own props change, so hover, focus, or a draft on
 * another card leaves it untouched; its labels follow the interface language through `useT`.
 */
const RailCard = memo(function RailCard({ card, attach, actions, readOnly, selected, paired, placed, composes,
  requested, draft, canReply, bodyInvalid }: CardProps) {
  const t = useT()
  const ime = useCompositionGuard()
  const replies = card.thread.comments.length - 1
  // A message reads author, then (opening message only) the quoted passage, then the comment, as
  // a resolved discussion does; the reply count follows the opening message.
  const message = (comment: ThreadCard['thread']['comments'][number], messageIndex: number) =>
    <ThreadMessage key={messageIndex} data-find-comment={card.messages[messageIndex]} reply={messageIndex > 0} body={comment.body}
      author={messageIndex === 0 ? <button type="button" className="rail-select" aria-expanded={selected}
        aria-label={`${t('resolvedOriginal')}: ${comment.author ?? t('comment')}`}
        onClick={() => actions.activate(card.spanIndex)}>
        <span className="rail-author">{comment.author ?? t('comment')}</span>
      </button> : <span className="rail-author">{comment.author ?? t('comment')}</span>}
      quote={messageIndex === 0 && card.anchorText ? <QuotedPassage text={card.anchorText} lines={selected ? 6 : 2} expandable={selected} /> : undefined}
      actions={<>
        {messageIndex === 0 && <button type="button" className="btn-ghost btn-icon rail-icon" aria-label={t('resolve')}
          title={t('resolve')} disabled={readOnly} onClick={() => actions.resolve(card)}><CheckIcon /></button>}
        <DiscussionMenu label={t('deleteComment')} disabled={readOnly}
          onSelect={() => actions.deleteMessage(card, messageIndex)} />
      </>} />
  return <div role="group" aria-label={t('resolvedOriginal')} ref={attach} data-keeps-discussion=""
    className={`rail-card${selected ? ' active' : ''}${paired ? ' paired' : ''}${placed ? '' : ' unplaced'}`}
    onPointerEnter={() => actions.hover(card.spanIndex)} onPointerLeave={() => actions.hover(null)}
    onFocus={() => actions.focusSpan(card.spanIndex)}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) actions.focusSpan(null) }}
    onClick={(event) => {
      if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [role="menuitem"]')) return
      if (window.getSelection()?.isCollapsed !== false) actions.activate(card.spanIndex)
    }}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && !ime.isComposing(event.nativeEvent) && !(event.target as HTMLElement).closest('[role="menu"]')) {
        event.stopPropagation()
        actions.collapse()
      }
    }}>
    {message(card.thread.comments[0]!, 0)}
    {replies > 0 && <RepliesDisclosure count={replies} expanded={selected}
      onToggle={() => selected ? actions.collapse(true) : actions.activate(card.spanIndex)}>
      {card.thread.comments.slice(1).map((comment, reply) => message(comment, reply + 1))}
    </RepliesDisclosure>}
    <Collapsible open={composes}><div className="rail-reply">
      {readOnly && <p role="status">{t('editingPaused')}</p>}
      <textarea autoFocus={requested} readOnly={readOnly} rows={2} {...ime.inputProps}
        value={draft} placeholder={t('replyPlaceholder')} aria-label={t('replyPlaceholder')}
        onChange={(event) => actions.setDraft(card, event.target.value)}
        onKeyDown={(event) => {
          if (ime.isComposing(event.nativeEvent)) { event.stopPropagation(); return }
          // Enter posts and Shift+Enter adds a line; an Enter that cannot post inserts nothing.
          if (event.key === 'Enter' && !event.shiftKey && !event.altKey) { event.preventDefault(); actions.submit(card) }
          if (event.key === 'Escape') { event.stopPropagation(); actions.collapse() }
        }} />
      <Collapsible open={bodyInvalid}><p role="alert">{t('commentBodyInvalid')}</p></Collapsible>
      <div className="rail-actions">
        {/* Cancel discards the draft; Escape and clicking away keep it for the next selection. */}
        <button type="button" className="btn-ghost btn-compact" onClick={() => actions.cancel(card)}>{t('cancel')}</button>
        <button type="button" className="btn-primary btn-compact" disabled={!canReply}
          onClick={() => actions.submit(card)}>{t('reply')}</button>
      </div>
    </div></Collapsible>
  </div>
})
