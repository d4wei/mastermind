import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APP_NAME, DEFAULT_AUTHOR_TAG } from '../../shared/constants'
import { rejectEdit } from '../../shared/critic/resolve'
import { analyzeMarkdown } from '../../shared/markdown/analyze'
import { parseMarkdown } from '../../shared/markdown/processor'
import { MarkdownView } from '../modes/reading/Renderer'
import { SelectionToolbar } from '../modes/reading/SelectionToolbar'
import { BlockActions } from '../modes/reading/BlockActions'
import { CommentRail } from '../review/CommentRail'
import { useNav } from './navStore'
import { MarkGutter, type MarkTick } from '../review/MarkGutter'
import { extractOutline } from '../modes/reading/outline'
import { parseAuthor } from '../../shared/critic/scanner'
import { SlotLabel } from '../util/SlotLabel'
import { useT } from '../i18n'
import { GearIcon } from '../icons'
import { useTranslation } from '../translate/translationStore'
import { TranslatedSelection } from '../translate/TranslatedSelection'
import { openEvents } from './api'
import { useConfig } from './configStore'
import { useDoc, type ViewMode } from './store'
import { parseResolvedThreads } from '../../shared/review-archive'
import { ResolvedThreads } from '../review/ResolvedThreads'
import { ConflictPanel } from './ConflictPanel'
import { TopBar } from './TopBar'

// Code-split the heavy / conditionally-rendered views so the initial bundle stays
// lean: CodeMirror (Source), the settings panel, find bar, rename dialog, and the
// translated view each load on demand. (named exports → default shim for lazy())
const SourceEditor = lazy(() => import('../modes/source/SourceEditor').then((m) => ({ default: m.SourceEditor })))
const SettingsPanel = lazy(() => import('../settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const FindBar = lazy(() => import('../review/FindBar').then((m) => ({ default: m.FindBar })))
const RenameDialog = lazy(() => import('./RenameDialog').then((m) => ({ default: m.RenameDialog })))
const TranslatedView = lazy(() => import('../translate/TranslatedView').then((m) => ({ default: m.TranslatedView })))

const MODE_CYCLE: Record<ViewMode, ViewMode> = { reading: 'source', source: 'reading' }

function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const status = useDoc((s) => s.status)
  const error = useDoc((s) => s.error)
  const source = useDoc((s) => s.source)
  const notice = useDoc((s) => s.notice)
  const renamePrompt = useDoc((s) => s.renamePrompt)
  const meta = useDoc((s) => s.meta)
  const mode = useDoc((s) => s.mode)
  const externalVersion = useDoc((s) => s.externalVersion)
  const comparisonOpen = useDoc((s) => s.conflictDraft?.open ?? false)
  const load = useDoc((s) => s.load)
  const applyEdits = useDoc((s) => s.applyEdits)

  const t = useT()
  const articleRef = useRef<HTMLElement | null>(null)
  const translatedRef = useRef<HTMLElement | null>(null)
  const [activeSpan, setActiveSpan] = useState<number | null>(null)
  const [railOpen, setRailOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [resolvedOpen, setResolvedOpen] = useState(false)
  const resolvedCount = useMemo(() => parseResolvedThreads(source).entries.length, [source])
  // Transient panels share one overlay home; opening one closes the others.
  const toggleSettings = useCallback(() => {
    setSettingsOpen((v) => {
      if (!v) { setFindOpen(false); setResolvedOpen(false); useDoc.getState().closeConflict() }
      return !v
    })
  }, [])
  useEffect(() => {
    if (comparisonOpen) {
      setSettingsOpen(false)
      setFindOpen(false)
      setResolvedOpen(false)
    }
  }, [comparisonOpen])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const authorTag = useConfig((s) => s.config?.authorTag) ?? DEFAULT_AUTHOR_TAG
  const comfortLang = useConfig((s) => s.config?.comfortLang) ?? null
  const highlightCode = (useConfig((s) => s.config?.codeTheme) ?? 'none') !== 'none'
  const translation = useTranslation()
  const retainedTranslation = useRef<{ sessionId: string; targetLang: string; artifact: NonNullable<typeof translation.artifact> } | null>(null)
  if (translation.artifact && translation.sessionId === sessionId && translation.targetLang === comfortLang) {
    retainedTranslation.current = { sessionId, targetLang: translation.artifact.targetLang, artifact: translation.artifact }
  }
  const captured = retainedTranslation.current
  const composerArtifact = translation.artifact ?? (translation.error === 'stale' &&
    captured?.sessionId === sessionId && captured.targetLang === comfortLang ? captured.artifact : null)
  const transActive = translation.active && translation.sessionId === sessionId &&
    translation.source === source && translation.targetLang === comfortLang
  useEffect(() => { void useTranslation.getState().synchronize() }, [sessionId, source, comfortLang])
  const transLoading = useTranslation((s) => s.loading)

  useEffect(() => {
    void load(sessionId)
    useTranslation.getState().reset()
  }, [sessionId, load])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => useDoc.getState().setNotice(null), notice.kind === 'error' ? 8000 : 5000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    // UI liveness keeps the review session open while its window remains attached.
    const es = openEvents(sessionId)
    es.addEventListener('file-changed', (e) => {
      const { mtimeMs } = JSON.parse((e as MessageEvent).data) as { mtimeMs: number }
      if (useDoc.getState().sessionId === sessionId) useDoc.getState().notifyDiskChange(mtimeMs)
    })
    es.addEventListener('file-deleted', () => {
      if (useDoc.getState().sessionId === sessionId) useDoc.getState().notifyDiskChange(0, true)
    })
    es.addEventListener('config-changed', () => {
      void useConfig.getState().load()
    })
    return () => es.close()
  }, [sessionId])

  const showTranslated = mode === 'reading' && transActive
  const analysis = useMemo(
    () => (status === 'ready' && mode === 'reading' && !showTranslated ? analyzeMarkdown(source) : null),
    [status, source, mode, showTranslated],
  )
  const anchoredHighlights = useMemo(() => {
    const set = new Set<number>()
    if (!analysis) return set
    for (const item of analysis.items) {
      if (item.type === 'thread' && item.anchor) {
        const idx = analysis.spans.indexOf(item.anchor)
        if (idx >= 0) set.add(idx)
      }
    }
    return set
  }, [analysis])

  // The heading outline drives the left navigator in both modes (so its
  // collapse/expand state persists across Reading/Source). Reading reuses its
  // critic-aware tree; Source parses the source directly.
  const outline = useMemo(
    () => (analysis ? extractOutline(analysis.tree) : status === 'ready' ? extractOutline(parseMarkdown(source)) : []),
    [analysis, status, source],
  )
  // Publish the outline + (in reading mode) the article element to the shared
  // navigator, which lives outside SessionView. docEl is null in source mode —
  // there the navigator scrolls via the registered editor scroller instead of
  // the article's data-ps offsets.
  useEffect(() => {
    useNav.getState().publish(outline, articleRef.current)
  }, [outline, mode, externalVersion])
  // Clear only on real unmount, so switching modes never blanks the outline
  // (which would briefly unmount the navigator and reset its transient state).
  useEffect(() => () => useNav.getState().publish([], null), [])
  const commentFootnotes = useMemo(() => {
    if (!analysis) return []
    return analysis.spans
      .filter((s) => s.kind === 'comment')
      .map((s) => parseAuthor(source.slice(s.innerStart, s.innerEnd)))
  }, [analysis, source])
  const markTicks = useMemo<MarkTick[]>(() => {
    if (!analysis) return []
    const ticks: MarkTick[] = []
    for (const item of analysis.items) {
      if (item.type === 'suggestion') {
        const idx = analysis.spans.indexOf(item.span)
        if (idx >= 0) ticks.push({ spanIndex: idx, kind: item.span.kind as MarkTick['kind'] })
      } else if (item.type === 'highlight') {
        // standalone highlights are no longer rendered (only comment anchors are),
        // so they get no gutter tick.
      } else {
        const anchor = item.anchor ?? item.comments[0]?.span
        const idx = anchor ? analysis.spans.indexOf(anchor) : -1
        if (idx >= 0) ticks.push({ spanIndex: idx, kind: 'comment' })
      }
    }
    return ticks
  }, [analysis])

  // global shortcuts: ⌘S (swallow), ⌘E (toggle view), ⌘F (find), ⌘Z (undo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘S is a no-op now — the buffer autosaves. Swallow it so the browser's
      // "save page" dialog never appears.
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
      // ⌘F opens the mark-aware find bar (reading mode, marks present); a second
      // ⌘F while it's open closes it, leaving native find for the next press
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        const s = useDoc.getState()
        if (s.mode === 'reading') {
          e.preventDefault()
          setFindOpen((v) => {
            if (!v) { setSettingsOpen(false); setResolvedOpen(false); useDoc.getState().closeConflict() }
            return !v
          })
        }
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
  }, [])

  // Remove a suggested deletion the user placed: rejecting a `del` keeps the
  // original text (unwraps the `{--…--}`). Reuses the live source/analysis.
  const undoDeletion = useCallback(
    (el: HTMLElement): boolean => {
      const span = analysis?.spans[Number(el.dataset.spanIndex)]
      if (!span || span.kind !== 'del') return false
      applyEdits([rejectEdit(source, span)])
      return true
    },
    [analysis, source, applyEdits],
  )

  // clicking a deletion removes it; clicking an anchored highlight / comment
  // marker activates its rail card.
  const onArticleClick = useCallback(
    (e: React.MouseEvent) => {
      // a drag-to-select that ends inside a deletion shouldn't also undo it
      if (window.getSelection()?.isCollapsed === false) return
      const del = (e.target as HTMLElement).closest('.critic-del') as HTMLElement | null
      if (del && undoDeletion(del)) return
      const target = (e.target as HTMLElement).closest('.critic-anchor, .critic-comment-marker')
      if (target) {
        const idx = Number((target as HTMLElement).dataset.spanIndex)
        if (Number.isFinite(idx)) setActiveSpan((prev) => (prev === idx ? null : idx))
      }
    },
    [undoDeletion],
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
      const target = (e.target as HTMLElement).closest('.critic-anchor, .critic-comment-marker')
      if (target) {
        e.preventDefault()
        const idx = Number((target as HTMLElement).dataset.spanIndex)
        if (Number.isFinite(idx)) setActiveSpan((prev) => (prev === idx ? null : idx))
      }
    },
    [undoDeletion],
  )

  const activeCardSpan = useMemo(() => {
    if (activeSpan === null || !analysis) return null
    for (const item of analysis.items) {
      if (item.type !== 'thread') continue
      const memberIdxs = [
        ...(item.anchor ? [analysis.spans.indexOf(item.anchor)] : []),
        ...item.comments.map((c) => analysis.spans.indexOf(c.span)),
      ]
      if (memberIdxs.includes(activeSpan)) {
        return item.anchor ? analysis.spans.indexOf(item.anchor) : analysis.spans.indexOf(item.comments[0]!.span)
      }
    }
    return null
  }, [activeSpan, analysis])

  useEffect(() => {
    const doc = articleRef.current
    if (!doc) return
    doc.querySelectorAll('.critic-anchor.active').forEach((el) => el.classList.remove('active'))
    if (activeCardSpan !== null) {
      doc.querySelector(`.critic-anchor[data-span-index="${activeCardSpan}"]`)?.classList.add('active')
    }
  }, [activeCardSpan, analysis])

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

  const hasThreads = analysis?.items.some((i) => i.type === 'thread') ?? false
  const showRail = mode === 'reading' && railOpen && hasThreads

  return (
    <>
      <TopBar
        resolved={{ count: resolvedCount, open: resolvedOpen, onToggle: () => {
          setResolvedOpen((value) => !value)
          setSettingsOpen(false)
          setFindOpen(false)
          useDoc.getState().closeConflict()
        } }}
        railOpen={railOpen}
        // Both controls stay mounted so the bar morphs between layouts; their
        // applicability (not their presence) is what changes per view.
        onToggleRail={() => setRailOpen((v) => !v)}
        commentsAvailable={mode === 'reading' && hasThreads && !showTranslated}
        translation={comfortLang ? {
          label: transActive ? t('original') : comfortLang,
          active: transActive,
          loading: transLoading,
          onToggle: () => void useTranslation.getState().toggle(),
        } : undefined}
      />
      {/* Settings lives on its own as a floating button in the bottom-right
          corner — outside the bottom bar — anchoring the panel that rises above it. */}
      <button
        type="button"
        className={`floating-settings${settingsOpen ? ' active' : ''}`}
        onClick={toggleSettings}
        aria-label={t('settings')}
        aria-pressed={settingsOpen}
        title={t('settings')}
      >
        <GearIcon width={16} height={16} />
      </button>
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={closeSettings} />
        </Suspense>
      )}
      {findOpen && mode === 'reading' && !showTranslated && analysis && (
        <Suspense fallback={null}>
          <FindBar analysis={analysis} source={source} docRef={articleRef} onClose={() => setFindOpen(false)} />
        </Suspense>
      )}
      {renamePrompt && (
        <Suspense fallback={null}>
          <RenameDialog />
        </Suspense>
      )}
      {resolvedOpen && <ResolvedThreads source={source} onClose={() => setResolvedOpen(false)} />}
      <ConflictPanel />
      {translation.error && <div className="banner" role="status"><span className="banner-text">
        {t(translation.error === 'missing' ? 'preparedMissing' : translation.error === 'stale' ? 'preparedStale' : 'preparedUnavailable')}
      </span></div>}
      <div className={`doc-shell${showRail ? ' with-rail' : ''}`}>
        <div className="doc-column">
          {showTranslated && (
            <Suspense fallback={<div className="center-note loading-note">{t('loadingDocument')}</div>}>
              {translation.artifact && <TranslatedView sessionId={sessionId} source={source} artifact={translation.artifact} containerRef={translatedRef} />}
            </Suspense>
          )}
          {mode === 'reading' && !showTranslated && analysis && (
            <article className="md-root" ref={articleRef} onClick={onArticleClick} onKeyDown={onArticleKeyDown}>
              <MarkdownView
                tree={analysis.tree}
                ctx={{
                  source,
                  onEdit: (edit) => applyEdits([edit]),
                  anchoredHighlights,
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
              <SourceEditor key={`s${externalVersion}`} />
            </Suspense>
          )}
        </div>
        {showRail && analysis && (
          <CommentRail
            items={analysis.items}
            spans={analysis.spans}
            source={source}
            docRef={articleRef}
            authorTag={authorTag}
            activeSpan={activeCardSpan}
            onActivate={setActiveSpan}
            onEdit={(edits) => {
              const current = useDoc.getState()
              if (current.sessionId === sessionId && current.source === source) current.applyEdits(edits)
            }}
          />
        )}
      </div>
      {mode === 'reading' && composerArtifact && translation.sessionId === sessionId &&
        translation.targetLang === comfortLang && (
        <TranslatedSelection key={`${sessionId}:${composerArtifact.sourceHash}:${comfortLang}`}
          containerRef={translatedRef} sessionId={sessionId} artifact={composerArtifact} authorTag={authorTag}
          stale={translation.error === 'stale'} />
      )}
      {mode === 'reading' && !showTranslated && analysis && (
        <>
          <SelectionToolbar
            containerRef={articleRef}
            source={source}
            spans={analysis.spans}
            authorTag={authorTag}
            onEdit={applyEdits}
          />
          <BlockActions
            containerRef={articleRef}
            source={source}
            spans={analysis.spans}
            authorTag={authorTag}
            onEdit={applyEdits}
          />
          {markTicks.length > 0 && !showRail && (
            <MarkGutter docRef={articleRef} marks={markTicks} version={externalVersion} />
          )}
        </>
      )}
      {notice && (
        <div className={`toast${notice.kind === 'error' ? ' toast-error' : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <SlotLabel
            revealOnMount
            text={
              notice.count !== undefined
                ? `${notice.count} ${t(notice.msg as never)} · ${t('undoHint')}`
                : t(notice.msg as never)
            }
          />
        </div>
      )}
    </>
  )
}
