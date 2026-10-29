import type { TextEdit } from '../../document/types'
import { useTableExpansion } from '../modes/reading/TableExpansion'
import { DraftScope, useDraftPending, useDraftState, useDraftValue, useDrafts } from '../review/drafts'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DocumentScroll } from './DocumentScroll'
import { APP_NAME, DEFAULT_AUTHOR_TAG, escapeOwner } from './constants'
import { rejectEdit } from '../../document/critic/resolve'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import { parseMarkdown } from '../../document/markdown/processor'
import { MarkdownView } from '../modes/reading/Renderer'
import { SelectionToolbar } from '../modes/reading/SelectionToolbar'
import { CommentRail } from '../review/CommentRail'
import { locateThread, rebaseReplies, rebaseThread, refreshReplies, refreshThread, threadRef,
  type ReplyDraft, type ThreadRef } from '../review/thread-identity'
import type { ThreadCard } from '../../document/critic/types'
import type { PreparedTranslation } from '../../document/translation'
import { closeOverlay, openOverlay, publishCommentRail, useOverlay } from './overlayStore'
import { MarkGutter } from '../review/MarkGutter'
import { extractOutline } from '../modes/reading/outline'
import { parseAuthor } from '../../document/critic/scanner'
import { useT } from '../i18n'
import { translationActive, useTranslation } from '../translate/translationStore'
import { TranslatedSelection } from '../translate/TranslatedSelection'
import { requireReviewerHost } from './host'
import { useConfig } from './configStore'
import { editingLocked, useDoc, type ViewMode } from '../documents/store'
import { parseResolvedThreads } from '../../document/review-archive'
import { ResolvedThreads } from '../review/ResolvedThreads'
import { Notice } from './Notifications'
import { ConflictPanel } from './ConflictPanel'
import { TopBar } from './TopBar'
import { SlideOver } from './SlideOver'
import { Navigator, useIsNarrow, type SourceOutline } from './Navigator'
import { readingSpace } from './reading-space'
import { useReadingSpace, useReadingMovement } from './useReadingSpace'
import { isImeKey } from '../util/composition'

// Defer the editor and optional panels to keep initial reading dependencies small.
const SourceEditor = lazy(() => import('../modes/source/SourceEditor').then((m) => ({ default: m.SourceEditor })))
const SettingsPanel = lazy(() => import('../settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const FindPanel = lazy(() => import('../find/FindPanel').then((m) => ({ default: m.FindPanel })))
const TranslatedView = lazy(() => import('../translate/TranslatedView').then((m) => ({ default: m.TranslatedView })))

const MODE_CYCLE: Record<ViewMode, ViewMode> = { reading: 'source', source: 'reading' }

/**
 * Holds a discussion choice by thread identity, so edits elsewhere cannot move it to another
 * discussion. Returns the chosen card's span index in the current analysis, a chooser taking any
 * member span index, and a rebase for edits about to be applied to `base`.
 */
function useThreadChoice(cards: ThreadCard[] | null, source: string) {
  const [chosen, setChosen] = useState<ThreadRef | null>(null)
  const current = useRef({ cards, source })
  current.current = { cards, source }
  const located = chosen && cards ? locateThread(chosen, source, cards) : null
  // Re-anchor after a source change, or forget a discussion that no longer exists. Without an
  // analysis (Markdown mode, translations) the choice waits for the next one.
  useEffect(() => {
    if (!chosen || !cards) return
    const next = refreshThread(chosen, source, cards)
    if (next !== chosen) setChosen(next)
  }, [chosen, cards, source])
  const choose = useCallback((spanIndex: number | null) => {
    const { cards, source } = current.current
    const card = spanIndex === null ? undefined : cards?.find((item) => item.members.includes(spanIndex))
    setChosen((ref) => !card || !cards ? null : ref?.source === source && ref.start === card.start &&
      ref.identity === card.identity ? ref : threadRef(card, source, cards))
  }, [])
  const rebase = useCallback((edits: readonly TextEdit[], base: string) => {
    setChosen((ref) => ref && rebaseThread(ref, base, edits))
  }, [])
  return [located?.spanIndex ?? null, choose, rebase] as const
}

/** A callback ref that mirrors its element into a ref for handlers and into state for renders. */
function useObservedElement() {
  const ref = useRef<HTMLElement | null>(null)
  const [element, setElement] = useState<HTMLElement | null>(null)
  const attach = useCallback((next: HTMLElement | null) => {
    ref.current = next
    setElement(next)
  }, [])
  return { ref, element, attach }
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const name = useDoc((s) => s.sessionId === sessionId ? s.meta?.displayName : undefined)
  return <DraftScope id={sessionId} name={name}><DocumentView sessionId={sessionId} /></DraftScope>
}

function DocumentView({ sessionId }: { sessionId: string }) {
  const loadedSessionId = useDoc((s) => s.sessionId)
  const status = useDoc((s) => s.status)
  const error = useDoc((s) => s.error)
  const source = useDoc((s) => s.source)
  const mode = useDoc((s) => s.mode)
  const externalVersion = useDoc((s) => s.externalVersion)
  const readOnly = useDoc(editingLocked)
  const load = useDoc((s) => s.load)
  const { collapse: collapseTable, hidden: tableExpanded } = useTableExpansion()

  const t = useT()
  // The outline locates headings in whichever article is mounted, so it observes both as state.
  const { ref: articleRef, element: articleElement, attach: articleContainer } = useObservedElement()
  const { ref: translatedRef, element: translatedElement, attach: translatedContainer } = useObservedElement()
  const [replyRequest, setReplyRequest] = useState<{ spanIndex: number } | null>(null)
  const replyHandled = useCallback(() => setReplyRequest(null), [])
  const translation = useTranslation()
  // An unfinished translated comment keeps the artifact it captured after its translation goes stale.
  const translatedSelection = useDraftValue<{ artifact: PreparedTranslation } | null>(sessionId, 'translated:selection')
  const translatedDraft = useDraftPending(sessionId, 'translated') ? translatedSelection : undefined
  const composerArtifact = translation.artifact ?? translatedDraft?.artifact
  const transActive = translationActive(translation, { sessionId, source })
  useEffect(() => {
    if (loadedSessionId === sessionId && status === 'ready') void useTranslation.getState().synchronize()
  }, [sessionId, source, status, loadedSessionId])

  const showTranslated = mode === 'reading' && transActive
  const analysis = useMemo(
    () => (status === 'ready' && mode === 'reading' && !showTranslated ? analyzeMarkdown(source) : null),
    [status, source, mode, showTranslated],
  )
  // Reuse the critic-aware reading tree; Markdown mode needs its own parse.
  const outline = useMemo(
    () => (analysis ? extractOutline(analysis.tree) : status === 'ready' ? extractOutline(parseMarkdown(source)) : []),
    [analysis, status, source],
  )
  const [sourceOutline, setSourceOutline] = useState<SourceOutline | null>(null)
  const smallWindow = useIsNarrow()
  const reading = useReadingSpace(outline.length >= 2)
  const narrow = smallWindow || reading.panel
  const [railOpen, setRailOpen] = useState(!narrow)
  useEffect(() => { if (narrow) setRailOpen(false) }, [narrow])
  const findOpenedRail = useRef(false)
  const closeRail = useCallback(() => { findOpenedRail.current = false; setRailOpen(false) }, [])
  const restoreFindRail = useCallback(() => {
    if (findOpenedRail.current) { setRailOpen(false); findOpenedRail.current = false }
  }, [])
  const panel = useOverlay((s) => s.owner === sessionId && (s.open === 'settings' || s.open === 'resolved') ? s.open : null)
  const resolvedCount = useMemo(() => parseResolvedThreads(source).entries.length, [source])
  const togglePanel = useCallback((next: 'settings' | 'resolved') => {
    if (narrow) setRailOpen(false)
    const { open, owner } = useOverlay.getState()
    if (open === next && owner === sessionId) closeOverlay(next)
    else openOverlay(next, sessionId)
  }, [narrow, sessionId])
  const closePanel = useCallback(() => {
    if (useOverlay.getState().owner === sessionId) closeOverlay('settings', 'resolved')
  }, [sessionId])
  // A panel lives no longer than its view: reopening the document starts with none.
  useEffect(() => closePanel, [closePanel])
  const draftFocus = useDrafts((s) => s.focus)
  useEffect(() => {
    if (draftFocus?.id !== sessionId) return
    useDoc.getState().setMode('reading')
    setRailOpen(true)
    closePanel()
  }, [draftFocus, sessionId, closePanel])
  const openRail = useCallback(() => {
    collapseTable()
    if (narrow) closePanel()
    setRailOpen(true)
  }, [narrow, collapseTable, closePanel])
  const toggleRail = useCallback(() => {
    collapseTable()
    findOpenedRail.current = false
    setRailOpen((v) => !v)
    if (narrow) closePanel()
  }, [narrow, collapseTable, closePanel])
  // A command raised before this view mounted belongs to no view.
  const viewCommand = useOverlay((s) => s.viewCommand)
  const handledCommand = useRef(viewCommand)
  useEffect(() => {
    if (viewCommand === handledCommand.current) return
    handledCommand.current = viewCommand
    if (!viewCommand) return
    if (viewCommand.command === 'toggle-comments') { toggleRail(); return }
    // Panel commands open; they never close a panel already showing.
    const { open, owner } = useOverlay.getState()
    if (open !== viewCommand.command || owner !== sessionId) togglePanel(viewCommand.command)
  }, [viewCommand, toggleRail, togglePanel, sessionId])
  const authorTag = useConfig((s) => s.config?.authorTag) ?? DEFAULT_AUTHOR_TAG
  const highlightCode = (useConfig((s) => s.config?.codeTheme) ?? 'none') !== 'none'
  const cards = analysis?.threads ?? null
  const [activeSpan, chooseActive, rebaseActive] = useThreadChoice(cards, source)
  const [hoveredSpan, chooseHovered, rebaseHovered] = useThreadChoice(cards, source)
  // Owned here rather than by the rail, which is unmounted while the narrow comments panel is closed.
  const [replyDrafts, setReplyDrafts] = useDraftState<ReplyDraft[]>('replies', [])
  // Each analysis re-anchors the drafts, so their uniqueness describes the source the next change
  // of unknown shape starts from. Without an analysis they wait for the next one.
  useEffect(() => {
    if (!cards) return
    const next = refreshReplies(replyDrafts, source, cards)
    if (next !== replyDrafts) setReplyDrafts(next)
  }, [cards, source, replyDrafts, setReplyDrafts])
  /**
   * The one path for review edits: they apply only to the source they were computed from, and the
   * selected and hovered discussions and reply drafts follow them exactly. Returns whether they applied.
   */
  const applyReviewEdits = useCallback((edits: TextEdit[], base: string): boolean => {
    const doc = useDoc.getState()
    if (doc.sessionId !== sessionId || doc.source !== base || editingLocked(doc)) return false
    collapseTable()
    rebaseActive(edits, base)
    rebaseHovered(edits, base)
    setReplyDrafts((drafts) => rebaseReplies(drafts, base, edits))
    doc.applyEdits(edits)
    return true
  }, [sessionId, collapseTable, rebaseActive, rebaseHovered, setReplyDrafts])
  const applyEdits = useCallback((edits: TextEdit[]) => applyReviewEdits(edits, source), [applyReviewEdits, source])
  const revealFindComment = useCallback((spanIndex: number) => {
    collapseTable()
    if (!railOpen) findOpenedRail.current = true
    setRailOpen(true)
    chooseActive(spanIndex)
  }, [railOpen, collapseTable, chooseActive])

  useEffect(() => {
    void load(sessionId)
    chooseActive(null)
    chooseHovered(null)
  }, [sessionId, load, chooseActive, chooseHovered])

  useEffect(() => {
    if (status !== 'ready') return
    let translationRefresh: ReturnType<typeof setTimeout> | undefined
    const refreshTranslations = () => {
      clearTimeout(translationRefresh)
      translationRefresh = setTimeout(() => { void useTranslation.getState().synchronize() }, 50)
    }
    const unsubscribe = requireReviewerHost().subscribe(sessionId, (event) => {
      if (event === 'translations') { refreshTranslations(); return }
      if (useDoc.getState().sessionId === sessionId) {
        refreshTranslations()
        useDoc.getState().notifyDiskChange(event === 'deleted')
      }
    })
    return () => { unsubscribe(); clearTimeout(translationRefresh) }
  }, [sessionId, status])

  const commentFootnotes = useMemo(() => {
    if (!analysis) return []
    return analysis.spans
      .filter((s) => s.kind === 'comment')
      .map((s) => parseAuthor(source.slice(s.innerStart, s.innerEnd)))
  }, [analysis, source])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.getElementById('root')?.inert || document.querySelector('.close-dialog[open]')) return
      // An open panel consumes Escape; its listener may run after this one, so check the DOM too.
      if (e.key === 'Escape' && !isImeKey(e) && !isTypingTarget(e) &&
        !e.defaultPrevented && !escapeOwner()) chooseActive(null)
      // Autosave owns persistence; suppress the browser’s save-page dialog.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        const s = useDoc.getState()
        s.setMode(MODE_CYCLE[s.mode])
        return
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        const s = useDoc.getState()
        if (s.mode === 'reading' && !isTypingTarget(e)) {
          e.preventDefault()
          s.undo()
        }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chooseActive])

  const undoDeletion = useCallback(
    (el: HTMLElement): boolean => {
      const span = analysis?.spans[Number(el.dataset.spanIndex)]
      if (editingLocked(useDoc.getState()) || !span || span.kind !== 'del') return false
      applyEdits([rejectEdit(source, span)])
      return true
    },
    [analysis, source, applyEdits],
  )

  /** Opens the discussion of a comment anchor or marker; returns false when `target` is neither. */
  const activateThread = useCallback(
    (target: EventTarget): boolean => {
      const thread = (target as HTMLElement).closest<HTMLElement>('.critic-anchor, .critic-comment-marker')
      if (!thread) return false
      const idx = Number(thread.dataset.spanIndex)
      if (Number.isFinite(idx)) {
        chooseActive(idx)
        setReplyRequest({ spanIndex: idx })
        openRail()
      }
      return true
    },
    [openRail, chooseActive],
  )
  const onArticleClick = useCallback(
    (e: React.MouseEvent) => {
      // a drag-to-select that ends inside a deletion shouldn't also undo it
      if (window.getSelection()?.isCollapsed === false) return
      const del = (e.target as HTMLElement).closest('.critic-del') as HTMLElement | null
      if (del && undoDeletion(del)) return
      if (!activateThread(e.target)) chooseActive(null)
    },
    [undoDeletion, activateThread, chooseActive],
  )
  const onArticleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const del = (e.target as HTMLElement).closest('.critic-del') as HTMLElement | null
      if (del) {
        e.preventDefault()
        undoDeletion(del)
        return
      }
      if (activateThread(e.target)) e.preventDefault()
    },
    [undoDeletion, activateThread],
  )

  useEffect(() => {
    const doc = articleRef.current
    if (!doc) return
    doc.querySelectorAll('.critic-anchor.active, .critic-comment-marker.active').forEach((el) => el.classList.remove('active'))
    if (activeSpan !== null) {
      doc.querySelector(`.critic[data-span-index="${activeSpan}"]`)?.classList.add('active')
    }
  }, [activeSpan, analysis])

  useEffect(() => {
    const doc = articleRef.current
    if (!doc) return
    doc.querySelectorAll('.critic.paired').forEach((element) => element.classList.remove('paired'))
    if (hoveredSpan !== null) doc.querySelector(`.critic[data-span-index="${hoveredSpan}"]`)?.classList.add('paired')
  }, [hoveredSpan, analysis])

  const hasThreads = (analysis?.items.some((i) => i.type === 'thread') ?? false) ||
    replyDrafts.some((draft) => !!draft.text.trim())
  const showRail = mode === 'reading' && railOpen && hasThreads
  const inlineRail = showRail && !narrow && !showTranslated
  const geometry = reading.space ? readingSpace(reading.space, inlineRail) : null
  useReadingMovement(reading.element, geometry?.left, inlineRail)
  const commentsAvailable = mode === 'reading' && hasThreads && !showTranslated
  useEffect(() => { publishCommentRail({ available: commentsAvailable, open: commentsAvailable && railOpen }) },
    [commentsAvailable, railOpen])
  useEffect(() => () => publishCommentRail({ available: false, open: false }), [])

  if (status === 'error') {
    return (
      <div className="center-note">
        <h1>{APP_NAME}</h1>
        <p>{error === '__session-not-found__' ? t('sessionNotFound') : error}</p>
      </div>
    )
  }
  if (status !== 'ready') {
    return <div className="center-note loading-note">{t('loadingDocument')}</div>
  }


  const commentRail = analysis && (
    <CommentRail
      readOnly={readOnly}
      analysis={analysis}
      source={source}
      docRef={articleRef}
      authorTag={authorTag}
      activeSpan={activeSpan}
      replyRequest={replyRequest}
      onReplyHandled={replyHandled}
      hoveredSpan={hoveredSpan}
      onHover={chooseHovered}
      onActivate={chooseActive}
      drafts={replyDrafts}
      onDraftsChange={setReplyDrafts}
      onEdit={applyEdits}
    />
  )

  return (
    <>
      <Navigator outline={outline} docEl={mode !== 'reading' ? null : showTranslated ? translatedElement : articleElement}
        source={sourceOutline} />
      <TopBar
        settings={{ open: panel === 'settings', onToggle: () => togglePanel('settings') }}
        resolved={{ count: resolvedCount, open: panel === 'resolved', onToggle: () => togglePanel('resolved') }}
        railOpen={railOpen}
        onToggleRail={toggleRail}
        commentsAvailable={commentsAvailable}
      />
      {panel === 'settings' && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={closePanel} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <FindPanel sessionId={sessionId} source={source} mode={showTranslated ? 'translated' : mode}
          docRef={showTranslated ? translatedRef : articleRef} analysis={analysis}
          onRevealComment={revealFindComment} onClose={restoreFindRail} />
      </Suspense>
      {panel === 'resolved' && <ResolvedThreads source={source} onClose={closePanel} />}
      <ConflictPanel />
      {translation.error && <Notice key={translation.error}>
        {t(translation.error === 'stale' ? 'preparedStale' : 'preparedUnavailable')}
      </Notice>}
      <DocumentScroll>
        <div ref={reading.ref} className={`doc-shell${inlineRail ? ' with-rail' : ''}`}
          style={geometry ? { marginLeft: geometry.left, width: geometry.width + geometry.extent,
            gridTemplateColumns: `${geometry.width}px${inlineRail ? ` ${geometry.extent}px` : ''}` } : undefined}>
          <div className="doc-column">
            {showTranslated && (
              <Suspense fallback={<div className="center-note loading-note">{t('loadingDocument')}</div>}>
                {translation.artifact && <TranslatedView source={source} artifact={translation.artifact} containerRef={translatedContainer} />}
              </Suspense>
            )}
            {mode === 'reading' && !showTranslated && analysis && (
              <article className="md-root" ref={articleContainer} onClick={onArticleClick} onKeyDown={onArticleKeyDown}
                onPointerOver={(event) => {
                  const target = (event.target as HTMLElement).closest<HTMLElement>('.critic-anchor, .critic-comment-marker')
                  chooseHovered(target ? Number(target.dataset.spanIndex) : null)
                }}
                onPointerLeave={() => chooseHovered(null)}>
                <MarkdownView
                  analysis={analysis}
                  ctx={{
                    source,
                    onEdit: (edit) => applyEdits([edit]),
                    highlightCode,
                    markLabels: {
                      deletion: t('markDeletion'),
                      hint: t('undoDeletion'),
                    },
                  }}
                />
                {commentFootnotes.length > 0 && (
                  <section className="print-footnotes">
                    <h2>{t('comments')}</h2>
                    <ol>
                      {commentFootnotes.map((c, i) => (
                        <li key={i}>
                          {c.author && <span className="pf-author">@{c.author}: </span>}
                          {c.body}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </article>
            )}
            {mode === 'source' && (
              <Suspense fallback={<div className="center-note loading-note">{t('loadingDocument')}</div>}>
                <SourceEditor key={`s${externalVersion}`} onOutline={setSourceOutline} />
              </Suspense>
            )}
          </div>
          {inlineRail && commentRail}
        </div>
      </DocumentScroll>
      {showRail && analysis && !showTranslated && narrow && (
        <div className="comments-panel" inert={tableExpanded} aria-hidden={tableExpanded}
          data-table-hidden={tableExpanded}>
          <SlideOver title={t('comments')} onClose={closeRail} ignoreSelector=".topbar-comments, .find-bar"
            returnFocus=".topbar-comments" focusOnOpen={!findOpenedRail.current}>
            {commentRail}
          </SlideOver>
        </div>
      )}
      {mode === 'reading' && composerArtifact && (translation.sessionId === sessionId || translatedDraft) && (
        <TranslatedSelection key={`${sessionId}:${translation.targetLang}`}
          containerRef={translatedRef} sessionId={sessionId} artifact={composerArtifact} authorTag={authorTag}
          readOnly={readOnly} stale={translation.error === 'stale' || !!translatedDraft && !transActive} />
      )}
      {mode === 'reading' && !showTranslated && analysis && (
        <>
          <SelectionToolbar
            readOnly={readOnly}
            containerRef={articleRef}
            source={source}
            analysis={analysis}
            authorTag={authorTag}
            onEdit={applyEdits}
          />
          {analysis.ticks.length > 0 && !showRail && (
            <MarkGutter docRef={articleRef} marks={analysis.ticks} />
          )}
        </>
      )}
    </>
  )
}
