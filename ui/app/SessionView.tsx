import type { TextEdit } from '../../document/types'
import { useTableExpansion } from '../modes/reading/TableExpansion'
import { DraftScope, useDraftPending, useDraftState, useDraftValue, useDrafts } from '../review/drafts'
import { lazy, startTransition, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef,
  useState } from 'react'
import type { Root } from 'mdast'
import { DocumentScroll } from './DocumentScroll'
import { APP_NAME, DEFAULT_AUTHOR_TAG, escapeOwner } from './constants'
import { rejectEdit } from '../../document/critic/resolve'
import { analyzeMarkdown, type Analysis } from '../../document/markdown/analyze'
import { parseMarkdown } from '../../document/markdown/processor'
import { MarkdownView } from '../modes/reading/Renderer'
import { SelectionToolbar } from '../modes/reading/SelectionToolbar'
import { CommentRail } from '../review/CommentRail'
import { locateThread, rebaseReplies, rebaseThread, refreshReplies, refreshThread, threadRef,
  type ReplyDraft, type ThreadRef } from '../review/thread-identity'
import type { ThreadCard } from '../../document/critic/types'
import type { PreparedTranslation } from '../../document/translation'
import { closeOverlay, openOverlay, publishCommentRail, requestFind, useOverlay } from './overlayStore'
import { MarkGutter } from '../review/MarkGutter'
import { extractOutline } from '../modes/reading/outline'
import { parseAuthor } from '../../document/critic/scanner'
import { useT } from '../i18n'
import { translationActive, useTranslation } from '../translate/translationStore'
import { TranslatedSelection } from '../translate/TranslatedSelection'
import { requireReviewerHost } from './host'
import { useConfig } from './configStore'
import { editingLocked, useDoc, type ViewMode } from '../documents/store'
import { countResolvedThreads } from '../../document/review-archive'
import { ResolvedThreads } from '../review/ResolvedThreads'
import { Notice } from './Notifications'
import { ConflictPanel } from './ConflictPanel'
import { TopBar } from './TopBar'
import { SlideOver } from './SlideOver'
import { Navigator, useIsNarrow, type SourceOutline } from './Navigator'
import { readingSpace } from './reading-space'
import { useReadingSpace, useReadingMovement } from './useReadingSpace'
import { isImeKey } from '../util/composition'
import { EXIT_MS_FALLBACK, prefersReducedMotion, usePresence } from '../util/presence'
import { rootMs } from '../util/css-tokens'
import { LoadingState, StateNote } from './LoadingState'

// Defer the editor and optional panels to keep initial reading dependencies small.
const SourceEditor = lazy(() => import('../modes/source/SourceEditor').then((m) => ({ default: m.SourceEditor })))
const SettingsPanel = lazy(() => import('../settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const FindPanel = lazy(() => import('../find/FindPanel').then((m) => ({ default: m.FindPanel })))
const TranslatedView = lazy(() => import('../translate/TranslatedView').then((m) => ({ default: m.TranslatedView })))

const MODE_CYCLE: Record<ViewMode, ViewMode> = { reading: 'source', source: 'reading' }

/** How long edits must pause before Markdown mode parses again for its outline and resolved count. */
const PARSE_PAUSE_MS = 300
/** Whether a view has mounted Find already; later views mount it at once, from the loaded chunk. */
let findLoaded = false

/** Runs `run` once the browser is idle, or after a short delay where it cannot say; returns a cancel. */
function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 2000 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(run, 500)
  return () => clearTimeout(id)
}

/** Runs `run` once mounted, after the effects of the siblings before it. */
function AfterMount({ run }: { run: () => void }) {
  useEffect(run, [run])
  return null
}

/** A plain parse with the session and source it describes. */
interface PlainParse { sessionId: string; source: string; tree: Root }

/**
 * The plain parse that stands in for a reading analysis while there is none (Markdown mode, the
 * translated view): `cached` when it describes `source`, otherwise the session's first parse at
 * once and later ones only after edits pause, so the result may describe an earlier source.
 */
function usePlainParse(sessionId: string, source: string, enabled: boolean, cached: Root | null): PlainParse | null {
  const [parsed, setParsed] = useState<PlainParse | null>(null)
  const current = parsed?.sessionId === sessionId ? parsed : null
  useLayoutEffect(() => {
    if (!enabled) return
    if (cached) {
      if (current?.tree !== cached) setParsed({ sessionId, source, tree: cached })
      return
    }
    if (current?.source === source) return
    const parse = () => setParsed({ sessionId, source, tree: parseMarkdown(source) })
    if (!current) { parse(); return }
    const timer = setTimeout(parse, PARSE_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [enabled, cached, current, sessionId, source])
  return !enabled ? null : cached ? { sessionId, source, tree: cached } : current
}

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

/**
 * Marks a surface where a click leaves the selected discussion selected; see the deselection
 * effect. Each discussion surface and each floating layer carries it where it is defined.
 */
const KEEPS_DISCUSSION = '[data-keeps-discussion]'
/** Pointer travel, in pixels, beyond which a press and release is a drag rather than a click. */
const DRAG_DISTANCE = 4

export function SessionView({ sessionId }: { sessionId: string }) {
  const name = useDoc((s) => s.sessionId === sessionId ? s.meta?.displayName : undefined)
  return <DraftScope id={sessionId} name={name}><DocumentView sessionId={sessionId} /></DraftScope>
}

function DocumentView({ sessionId }: { sessionId: string }) {
  const loadedSessionId = useDoc((s) => s.sessionId)
  const status = useDoc((s) => s.status)
  const error = useDoc((s) => s.error)
  const source = useDoc((s) => s.source)
  const requestedMode = useDoc((s) => s.mode)
  // The view follows a mode switch in the background, so the outgoing view stays in place until the
  // incoming mode's chunk has loaded; the document column's one Suspense boundary holds it.
  const mode = useDeferredValue(requestedMode)
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
  // The last analysis, kept by its source, so leaving and returning to reading with the source
  // unchanged analyzes it once.
  const analyzed = useRef<{ source: string; analysis: Analysis } | null>(null)
  const analysis = useMemo(() => {
    if (status !== 'ready' || mode !== 'reading' || showTranslated) return null
    if (analyzed.current?.source !== source) analyzed.current = { source, analysis: analyzeMarkdown(source) }
    return analyzed.current.analysis
  }, [status, source, mode, showTranslated])
  const cachedPlain = analyzed.current?.source === source ? analyzed.current.analysis.plain : null
  const plainParse = usePlainParse(sessionId, source, status === 'ready' && !analysis, cachedPlain)
  // Reuse the critic-aware reading tree; Markdown mode reads a plain parse.
  const outline = useMemo(
    () => (analysis ? extractOutline(analysis.tree) : plainParse ? extractOutline(plainParse.tree) : []),
    [analysis, plainParse?.tree],
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
  const resolvedCount = useMemo(() => analysis ? countResolvedThreads(source, analysis.plain)
    : plainParse ? countResolvedThreads(plainParse.source, plainParse.tree) : 0, [analysis, source, plainParse?.tree])
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
  // Pointer hover and keyboard focus each emphasize a discussion; neither ends the other's.
  const [hoveredSpan, chooseHovered, rebaseHovered] = useThreadChoice(cards, source)
  const [focusedSpan, chooseFocused, rebaseFocused] = useThreadChoice(cards, source)
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
    rebaseFocused(edits, base)
    setReplyDrafts((drafts) => rebaseReplies(drafts, base, edits))
    doc.applyEdits(edits)
    return true
  }, [sessionId, collapseTable, rebaseActive, rebaseHovered, rebaseFocused, setReplyDrafts])
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
    chooseFocused(null)
  }, [sessionId, load, chooseActive, chooseHovered, chooseFocused])

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
  // The document renders again only for a new analysis or context: hover, focus, and selection
  // leave both alone. Task checkboxes edit through the latest `applyEdits`, which reads the source.
  const latestApplyEdits = useRef(applyEdits)
  useLayoutEffect(() => { latestApplyEdits.current = applyEdits })
  const editTask = useCallback((edit: TextEdit) => latestApplyEdits.current([edit]), [])
  const deletionLabel = t('markDeletion')
  const undoDeletionLabel = t('undoDeletion')
  const renderCtx = useMemo(() => ({ source, onEdit: editTask, highlightCode,
    markLabels: { deletion: deletionLabel, hint: undoDeletionLabel } }),
  [source, editTask, highlightCode, deletionLabel, undoDeletionLabel])
  const commentsLabel = t('comments')
  const printFootnotes = useMemo(() => commentFootnotes.length > 0 && (
    <section className="print-footnotes">
      <h2>{commentsLabel}</h2>
      <ol>
        {commentFootnotes.map((c, i) => (
          <li key={i}>
            {c.author && <span className="pf-author">@{c.author}: </span>}
            {c.body}
          </li>
        ))}
      </ol>
    </section>
  ), [commentFootnotes, commentsLabel])

  // The rail mounts in a transition after the document first renders; it fades in at its anchors
  // either way, and its geometry is reserved from the start.
  const [railMountable, setRailMountable] = useState(false)
  useEffect(() => {
    if (status === 'ready' && !railMountable) startTransition(() => setRailMountable(true))
  }, [status, railMountable])

  // Find mounts on its first request, or once the view is idle, so its chunk stays out of the first
  // render. A request made before it mounted is replayed once it can observe one.
  const [findMounted, setFindMounted] = useState(findLoaded)
  const findRequest = useOverlay((s) => s.findRequest)
  const mountedFindRequest = useRef(findRequest)
  const replayFind = useRef(false)
  useEffect(() => {
    if (findMounted) { findLoaded = true; return }
    const mount = (replay: boolean) => { replayFind.current ||= replay; setFindMounted(true) }
    if (findRequest !== mountedFindRequest.current) { mount(true); return }
    const key = (event: KeyboardEvent) => {
      if (document.getElementById('root')?.inert || isImeKey(event)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); mount(true) }
    }
    window.addEventListener('keydown', key, true)
    const cancelIdle = whenIdle(() => mount(false))
    return () => { window.removeEventListener('keydown', key, true); cancelIdle() }
  }, [findMounted, findRequest])
  const findReady = useCallback(() => {
    if (!replayFind.current) return
    replayFind.current = false
    requestFind()
  }, [])
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
      activateThread(e.target)
    },
    [undoDeletion, activateThread],
  )
  // A click anywhere but a surface marked `KEEPS_DISCUSSION` deselects the discussion, keeping its
  // reply draft as Escape does. Cards and passages carry the mark and select through their own
  // handlers; menus, tooltips, dialogs, panels, Find, notifications, and the selection toolbar carry
  // it and leave the selection. The narrow comments panel holds the rail, so only its cards do.
  useEffect(() => {
    if (activeSpan === null) return
    // The press that began the coming click. A press that ends without one (a context menu, a touch
    // turned into a scroll) or a key that can click is forgotten, so it cannot measure a later click.
    let pressed: { x: number; y: number } | null = null
    const press = (event: PointerEvent): void => { pressed = { x: event.clientX, y: event.clientY } }
    const forget = (): void => { pressed = null }
    const click = (event: MouseEvent): void => {
      const from = pressed
      pressed = null
      if (event.button !== 0) return
      // A drag, such as selecting text, is not a click elsewhere.
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRAG_DISTANCE) return
      const target = event.composedPath()[0]
      // A control the click removed, such as a menu item, was inside what it belonged to.
      if (!(target instanceof Element) || !target.isConnected || target.closest(KEEPS_DISCUSSION)) return
      if (target.closest('.md-root') && window.getSelection()?.isCollapsed === false) return
      chooseActive(null)
    }
    const forgetting = ['pointercancel', 'contextmenu', 'keydown'] as const
    document.addEventListener('pointerdown', press, true)
    for (const type of forgetting) document.addEventListener(type, forget, true)
    document.addEventListener('click', click)
    return () => {
      document.removeEventListener('pointerdown', press, true)
      for (const type of forgetting) document.removeEventListener(type, forget, true)
      document.removeEventListener('click', click)
    }
  }, [activeSpan, chooseActive])
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
    for (const span of [hoveredSpan, focusedSpan]) {
      if (span !== null) doc.querySelector(`.critic[data-span-index="${span}"]`)?.classList.add('paired')
    }
  }, [hoveredSpan, focusedSpan, analysis])

  const hasThreads = (analysis?.items.some((i) => i.type === 'thread') ?? false) ||
    replyDrafts.some((draft) => !!draft.text.trim())
  const showRail = mode === 'reading' && railOpen && hasThreads
  const inlineSpace = mode === 'reading' && !narrow && !showTranslated
  const inlineRail = showRail && inlineSpace
  // Hiding inline comments fades the rail out at its anchors before the document recenters; leaving
  // reading or the wide layout removes it at once, since its anchors are gone.
  const railExitMs = useMemo(() => rootMs('--dur-fast', EXIT_MS_FALLBACK), [])
  const railPresence = usePresence(inlineRail, railExitMs)
  const railLeaving = !inlineRail && railPresence.mounted && inlineSpace && hasThreads && !prefersReducedMotion()
  const railPlaced = inlineRail || railLeaving
  const geometry = reading.space ? readingSpace(reading.space, railPlaced) : null
  useReadingMovement(reading.element, geometry?.left, railPlaced)
  const commentsAvailable = mode === 'reading' && hasThreads && !showTranslated
  // The native menu describes the requested mode at once, while the view may still be catching up.
  const commentsPublished = commentsAvailable && requestedMode === 'reading'
  useEffect(() => { publishCommentRail({ available: commentsPublished, open: commentsPublished && railOpen }) },
    [commentsPublished, railOpen])
  useEffect(() => () => publishCommentRail({ available: false, open: false }), [])

  if (status === 'error') {
    return (
      <StateNote>
        <h1>{APP_NAME}</h1>
        <p>{error === '__session-not-found__' ? t('sessionNotFound') : error}</p>
      </StateNote>
    )
  }
  if (status !== 'ready') {
    return <LoadingState label={t('loadingDocument')} />
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
      focusedSpan={focusedSpan}
      onHover={chooseHovered}
      onFocusSpan={chooseFocused}
      onActivate={chooseActive}
      drafts={replyDrafts}
      onDraftsChange={setReplyDrafts}
      onEdit={applyEdits}
      leaving={railLeaving}
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
      {findMounted && <Suspense fallback={null}>
        <FindPanel sessionId={sessionId} source={source} mode={showTranslated ? 'translated' : mode}
          docRef={showTranslated ? translatedRef : articleRef} analysis={analysis}
          onRevealComment={revealFindComment} onClose={restoreFindRail} />
        <AfterMount run={findReady} />
      </Suspense>}
      {panel === 'resolved' && <ResolvedThreads source={source} onClose={closePanel} readOnly={readOnly} onEdit={applyEdits} />}
      <ConflictPanel />
      {translation.error && <Notice key={translation.error} tier="transient">
        {t(translation.error === 'stale' ? 'preparedStale' : 'preparedUnavailable')}
      </Notice>}
      <DocumentScroll>
        <div ref={reading.ref} className={`doc-shell${railPlaced ? ' with-rail' : ''}`}
          style={geometry ? { marginLeft: geometry.left, width: geometry.width + geometry.extent,
            gridTemplateColumns: `${geometry.width}px${railPlaced ? ` ${geometry.extent}px` : ''}` } : undefined}>
          <div className="doc-column">
            <Suspense fallback={<LoadingState label={t('loadingDocument')} />}>
              {showTranslated && translation.artifact &&
                <TranslatedView source={source} artifact={translation.artifact} containerRef={translatedContainer} />}
              {mode === 'reading' && !showTranslated && analysis && (
                <article className="md-root" ref={articleContainer} onClick={onArticleClick} onKeyDown={onArticleKeyDown}
                  onPointerOver={(event) => {
                    const target = (event.target as HTMLElement).closest<HTMLElement>('.critic-anchor, .critic-comment-marker')
                    chooseHovered(target ? Number(target.dataset.spanIndex) : null)
                  }}
                  onPointerLeave={() => chooseHovered(null)}>
                  <MarkdownView analysis={analysis} ctx={renderCtx} />
                  {printFootnotes}
                </article>
              )}
              {mode === 'source' && <SourceEditor key={`s${externalVersion}`} onOutline={setSourceOutline} />}
            </Suspense>
          </div>
          {railPlaced && railMountable && commentRail}
        </div>
      </DocumentScroll>
      {showRail && analysis && !showTranslated && narrow && (
        <div className="comments-panel" inert={tableExpanded} aria-hidden={tableExpanded}
          data-table-hidden={tableExpanded}>
          <SlideOver title={t('comments')} onClose={closeRail} ignoreSelector=".topbar-comments, .find-bar" keepsDiscussion={false}
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
