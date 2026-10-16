import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APP_NAME, DEFAULT_AUTHOR_TAG } from './constants'
import { rejectEdit } from '../../document/critic/resolve'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import { parseMarkdown } from '../../document/markdown/processor'
import { MarkdownView } from '../modes/reading/Renderer'
import { SelectionToolbar } from '../modes/reading/SelectionToolbar'
import { CommentRail } from '../review/CommentRail'
import { useNav } from './navStore'
import { MarkGutter, type MarkTick } from '../review/MarkGutter'
import { extractOutline } from '../modes/reading/outline'
import { parseAuthor } from '../../document/critic/scanner'
import { SlotLabel } from '../util/SlotLabel'
import { useT } from '../i18n'
import { useTranslation } from '../translate/translationStore'
import { TranslatedSelection } from '../translate/TranslatedSelection'
import { requireReviewerHost } from './host'
import { useConfig } from './configStore'
import { useDoc, type ViewMode } from '../documents/store'
import { parseResolvedThreads } from '../../document/review-archive'
import { ResolvedThreads } from '../review/ResolvedThreads'
import { ConflictPanel } from './ConflictPanel'
import { TopBar } from './TopBar'
import { SlideOver } from './SlideOver'
import { useIsNarrow } from './Navigator'

// Defer the editor and optional panels to keep initial reading dependencies small.
const SourceEditor = lazy(() => import('../modes/source/SourceEditor').then((m) => ({ default: m.SourceEditor })))
const SettingsPanel = lazy(() => import('../settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const FindBar = lazy(() => import('../review/FindBar').then((m) => ({ default: m.FindBar })))
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
  const narrow = useIsNarrow()
  const [railOpen, setRailOpen] = useState(!narrow)
  useEffect(() => { if (narrow) setRailOpen(false) }, [narrow])
  const closeRail = useCallback(() => setRailOpen(false), [])
  const [panel, setPanel] = useState<'settings' | 'find' | 'resolved' | null>(null)
  const resolvedCount = useMemo(() => parseResolvedThreads(source).entries.length, [source])
  const togglePanel = useCallback((next: 'settings' | 'find' | 'resolved') => {
    useDoc.getState().closeConflict()
    if (narrow) setRailOpen(false)
    setPanel((current) => current === next ? null : next)
  }, [narrow])
  useEffect(() => {
    if (comparisonOpen) {
      if (narrow) setRailOpen(false)
      setPanel(null)
    }
  }, [comparisonOpen, narrow])
  const closePanel = useCallback(() => setPanel(null), [])
  const openRail = useCallback(() => {
    if (narrow) {
      setPanel(null)
      useDoc.getState().closeConflict()
    }
    setRailOpen(true)
  }, [narrow])
  const authorTag = useConfig((s) => s.config?.authorTag) ?? DEFAULT_AUTHOR_TAG
  const translationLanguage = useConfig((s) => s.config?.translationLanguage) ?? null
  const highlightCode = (useConfig((s) => s.config?.codeTheme) ?? 'none') !== 'none'
  const translation = useTranslation()
  const retainedTranslation = useRef<{ sessionId: string; targetLang: string; artifact: NonNullable<typeof translation.artifact> } | null>(null)
  if (translation.artifact && translation.sessionId === sessionId && translation.targetLang === translationLanguage) {
    retainedTranslation.current = { sessionId, targetLang: translation.artifact.targetLang, artifact: translation.artifact }
  }
  const captured = retainedTranslation.current
  const composerArtifact = translation.artifact ?? (translation.error === 'stale' &&
    captured?.sessionId === sessionId && captured.targetLang === translationLanguage ? captured.artifact : null)
  const transActive = translation.active && translation.sessionId === sessionId &&
    translation.source === source && translation.targetLang === translationLanguage
  useEffect(() => { void useTranslation.getState().synchronize() }, [sessionId, source, translationLanguage])
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
    if (status !== 'ready') return
    return requireReviewerHost().subscribe(sessionId, (event) => {
      if (event === 'config') { void useConfig.getState().load(); return }
      if (useDoc.getState().sessionId === sessionId) {
        useDoc.getState().notifyDiskChange(0, event === 'deleted')
      }
    })
  }, [sessionId, status])

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

  // Reuse the critic-aware reading tree; Markdown mode needs its own parse.
  const outline = useMemo(
    () => (analysis ? extractOutline(analysis.tree) : status === 'ready' ? extractOutline(parseMarkdown(source)) : []),
    [analysis, status, source],
  )
  useEffect(() => {
    useNav.getState().publish(outline, mode === 'reading' ? articleRef.current : null)
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        const s = useDoc.getState()
        if (s.mode === 'reading') {
          e.preventDefault()
          togglePanel('find')
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
  }, [togglePanel])

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
        if (Number.isFinite(idx)) {
          setActiveSpan((prev) => (prev === idx ? null : idx))
          openRail()
        }
      }
    },
    [undoDeletion, openRail],
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
        if (Number.isFinite(idx)) {
          setActiveSpan((prev) => (prev === idx ? null : idx))
          openRail()
        }
      }
    },
    [undoDeletion, openRail],
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

  const commentRail = analysis && (
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
  )

  return (
    <>
      <TopBar
        settings={{ open: panel === 'settings', onToggle: () => togglePanel('settings') }}
        resolved={{ count: resolvedCount, open: panel === 'resolved', onToggle: () => togglePanel('resolved') }}
        railOpen={railOpen}
        onToggleRail={() => {
          setRailOpen((v) => !v)
          if (narrow) {
            setPanel(null)
            useDoc.getState().closeConflict()
          }
        }}
        commentsAvailable={mode === 'reading' && hasThreads && !showTranslated}
        translation={translationLanguage ? {
          label: transActive ? t('original') : translationLanguage,
          active: transActive,
          loading: transLoading,
          onToggle: () => void useTranslation.getState().toggle(),
        } : undefined}
      />
      {panel === 'settings' && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={closePanel} />
        </Suspense>
      )}
      {panel === 'find' && mode === 'reading' && !showTranslated && analysis && (
        <Suspense fallback={null}>
          <FindBar analysis={analysis} source={source} docRef={articleRef} onClose={closePanel} />
        </Suspense>
      )}
      {panel === 'resolved' && <ResolvedThreads source={source} onClose={closePanel} />}
      <ConflictPanel />
      {translation.error && <div className="banner" role="status"><span className="banner-text">
        {t(translation.error === 'missing' ? 'preparedMissing' : translation.error === 'stale' ? 'preparedStale' : 'preparedUnavailable')}
      </span></div>}
      <div className="document-scroll">
        <div className={`doc-shell${showRail && !narrow ? ' with-rail' : ''}`}>
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
          {showRail && analysis && !showTranslated && !narrow && commentRail}
        </div>
      </div>
      {showRail && analysis && !showTranslated && narrow && (
        <div className="comments-panel">
          <SlideOver title={t('comments')} onClose={closeRail} ignoreSelector=".topbar-comments">
            {commentRail}
          </SlideOver>
        </div>
      )}
      {mode === 'reading' && composerArtifact && translation.sessionId === sessionId &&
        translation.targetLang === translationLanguage && (
        <TranslatedSelection key={`${sessionId}:${translationLanguage}`}
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
