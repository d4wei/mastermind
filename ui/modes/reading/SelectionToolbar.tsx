import { READING_LAYOUT_EVENT } from '../../app/reading-space'
import { escapeOwner } from '../../app/constants'
import { useDraftGuard, useDraftState } from '../../review/drafts'
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Analysis } from '../../../document/markdown/analyze'
import type { TextEdit } from '../../../document/types'
import { useT, type MsgKey } from '../../i18n'
import { ChatIcon, PencilIcon } from '../../icons'
import { usePresence } from '../../util/presence'
import { useCompositionGuard } from '../../util/composition'
import { cssMs } from '../../util/css-tokens'
import { mapSelection, type ExcludedSegment, type ExclusionReason, type SelRange } from './selection'
import { documentViewport } from '../../util/scroll'
import { commentBodyFits, commentVerdict, changeVerdict, type MarkVerdict } from './marks'

/** The exit lasts `--dur-fast`; this stands in when the theme stylesheet is absent. */
const FALLBACK_EXIT_MS = 120

interface Props {
  readOnly?: boolean
  containerRef: RefObject<HTMLElement | null>
  source: string
  /** The analysis of `source`. */
  analysis: Pick<Analysis, 'plain' | 'spans' | 'tree' | 'provenance'>
  authorTag: string
  /** Returns whether the edits applied; a refused edit keeps the composed draft. */
  onEdit: (edits: TextEdit[]) => boolean
}

interface Active {
  source: string
  /** Editable fragments in source order; existing marks and unmappable text stay outside them. */
  ranges: SelRange[]
  /** Selected text no fragment covers; the toolbar explains why instead of dropping it silently. */
  excluded: ExcludedSegment[]
  rect: { top: number; left: number; width: number }
}

const REASON_MESSAGES: Record<ExclusionReason, MsgKey> = {
  'existing-mark': 'selectionExistingMark',
  'generated-text': 'selectionGeneratedText',
  'opaque-block': 'selectionOpaqueBlock',
  'partial-code': 'selectionPartialCode',
  'partial-link': 'selectionPartialLink',
  'multiple-translated-blocks': 'selectionTranslatedBlocks',
  'no-provenance': 'selectionUnmatched',
}

/** One sentence per distinct reason, in the order the selection meets them. */
function exclusionMessage(t: (key: MsgKey) => string, excluded: readonly ExcludedSegment[]): string {
  return [...new Set(excluded.map((segment) => segment.reason))].map((reason) => t(REASON_MESSAGES[reason])).join(' ')
}

export function SelectionToolbar({ containerRef, source, analysis, authorTag, onEdit, readOnly = false }: Props) {
  const t = useT()
  const ime = useCompositionGuard()
  const [active, setActive] = useDraftState<Active | null>('selection:active', null)
  const [composing, setComposing] = useDraftState<'comment' | 'change' | null>('selection:kind', null)
  const [replacements, setReplacements] = useDraftState<string[]>('selection:replacements', [])
  const [comment, setComment] = useDraftState('selection:comment', '')
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [toolbarHeight, setToolbarHeight] = useState(44)
  const composingRef = useRef(false)
  composingRef.current = composing !== null
  const lastActive = useRef<Active | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const selectedRange = useRef<Range | null>(null)
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelSelectionCheck = (): void => {
    if (selectionTimer.current !== null) clearTimeout(selectionTimer.current)
    selectionTimer.current = null
  }
  const dismiss = (): void => {
    cancelSelectionCheck()
    composingRef.current = false
    setComposing(null)
    setComment('')
    setReplacements([])
    setActive(null)
  }
  /** The current selection's coverage; null when nothing is selected, undefined while its DOM is outdated. */
  const readSelection = (): Active | null | undefined => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !containerRef.current) return null
    const range = sel.getRangeAt(0)
    const mapped = mapSelection(range, source, analysis, containerRef.current)
    if (mapped.status === 'inactive') return null
    if (mapped.status === 'outdated') return undefined
    selectedRange.current = range.cloneRange()
    const rect = range.getBoundingClientRect()
    return { source: mapped.revision, ranges: mapped.segments, excluded: mapped.excluded,
      rect: { top: rect.top, left: rect.left, width: rect.width } }
  }

  useEffect(() => {
    const onSelectionChange = (): void => {
      cancelSelectionCheck()
      if (composingRef.current) return
      selectionTimer.current = setTimeout(() => {
        selectionTimer.current = null
        // Focus entering a composer may collapse the browser selection after this check was queued.
        if (composingRef.current) return
        // An outdated read waits for the render that follows its source change, which reads again.
        const next = readSelection()
        if (next !== undefined) setActive(next)
      }, 120)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    // A shown toolbar's selection can survive a source change without a new event; re-read it.
    if (activeRef.current) onSelectionChange()
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      cancelSelectionCheck()
    }
  }, [containerRef, source, analysis])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (ime.isComposing(e) || e.defaultPrevented) return
      if (e.key === 'Escape') {
        if (escapeOwner()) return
        dismiss()
      }
    }
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const sel = window.getSelection()
        const range = selectedRange.current?.commonAncestorContainer.isConnected
          ? selectedRange.current : sel?.rangeCount ? sel.getRangeAt(0) : null
        if (!range) return
        const rect = range.getBoundingClientRect()
        setActive((prev) => (prev ? { ...prev, rect: { top: rect.top, left: rect.left, width: rect.width } } : prev))
      })
    }
    const scrollTarget = documentViewport().target
    if (active) {
      window.addEventListener('keydown', onKey)
      scrollTarget.addEventListener('scroll', onScroll, { passive: true, capture: true })
      window.addEventListener(READING_LAYOUT_EVENT, onScroll)
      window.addEventListener('mastermind-table-layout', onScroll)
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      scrollTarget.removeEventListener('scroll', onScroll, true)
      window.removeEventListener(READING_LAYOUT_EVENT, onScroll)
      window.removeEventListener('mastermind-table-layout', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [!!active])

  const meaningful = composing === 'comment' ? !!comment.trim() : composing === 'change' &&
    !!active && replacements.some((text, index) => text !== active.ranges[index]?.text)
  useDraftGuard('selection', t(composing === 'change' ? 'suggestChange' : 'comment'), meaningful,
    () => { requestAnimationFrame(() => toolbarRef.current?.querySelector('textarea')?.focus()) },
    dismiss)

  const exitMs = useMemo(() => cssMs(getComputedStyle(document.documentElement), '--dur-fast') ?? FALLBACK_EXIT_MS, [])
  // Preserve the last position while the toolbar exits.
  const present = usePresence(!!active, exitMs)
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const measure = () => setToolbarHeight(toolbar.getBoundingClientRect().height || 44)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(toolbar)
    return () => observer?.disconnect()
  }, [present.mounted, composing])
  if (active) lastActive.current = active
  const view = active ?? lastActive.current
  const verify = (text: string, changes: readonly string[]): MarkVerdict => {
    if (!view) return { edits: [] }
    // The analysis describes only the current source; a stale view analyzes its own.
    const known = source === view.source ? analysis : undefined
    return composing === 'change' ? changeVerdict(view.source, view.ranges, changes, known)
      : composing === 'comment' && text.trim() ? commentVerdict(view.source, view.ranges, authorTag, text, known)
        : { edits: [] }
  }
  // Verifying reparses the document, so the composer's verdict follows its deferred text and is
  // kept across renders, such as scroll frames, that change none of its inputs; submission verifies
  // the final text.
  const deferredComment = useDeferredValue(comment)
  const deferredReplacements = useDeferredValue(replacements)
  const verdict = useMemo(() => verify(deferredComment, deferredReplacements),
    [composing, view?.source, view?.ranges, deferredComment, deferredReplacements, source, analysis, authorTag])
  if (!present.mounted || !view) return null

  const begin = (kind: 'comment' | 'change'): void => {
    if (!active || present.exiting || readOnly) return
    const target = selectionTimer.current !== null ? readSelection() ?? active : active
    if (!target.ranges.length) return
    cancelSelectionCheck()
    setActive(target)
    composingRef.current = true
    if (kind === 'change') setReplacements(target.ranges.map((range) => range.text))
    setComposing(kind)
  }
  const finish = (edits: TextEdit[]): void => {
    if (readOnly || !onEdit(edits)) return
    window.getSelection()?.removeAllRanges()
    dismiss()
  }
  // A refused draft, whose insert would not reparse as the intended mark in place or would change
  // the Markdown around it, stays editable but cannot submit.
  const current = source === view.source && !readOnly
  const canSubmit = current && 'edits' in verdict && verdict.edits.length > 0
  const submit = (): void => {
    const final = current ? verify(comment, replacements) : null
    if (final && 'edits' in final && final.edits.length) finish(final.edits)
  }
  const refusal = 'refused' in verdict ? verdict.refused === 'formatting' ? 'markChangesFormatting'
    : composing === 'change' ? 'changeInvalid'
      : commentBodyFits(authorTag, deferredComment) ? 'commentInvalid' : 'commentBodyInvalid' : null
  const scope = view.excluded.length ? `${t('selectionPartial')} ${exclusionMessage(t, view.excluded)}` : null
  const composerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (ime.isComposing(e.nativeEvent) || e.defaultPrevented) { e.stopPropagation(); return }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
    else if (e.key === 'Escape') {
      dismiss()
    }
    e.stopPropagation()
  }

  const top = Math.max(8, Math.min(view.rect.top - toolbarHeight - 8, window.innerHeight - toolbarHeight - 8))
  const left = Math.min(Math.max(8, view.rect.left + view.rect.width / 2 - 130), window.innerWidth - 280)

  return (
    <div ref={toolbarRef}
      className={`sel-toolbar${present.exiting ? ' closing' : ''}`}
      style={{ top, left }}
      onMouseDown={(e) => {
        // Preserve the document selection without stealing the composer caret.
        if ((e.target as HTMLElement).tagName !== 'TEXTAREA') e.preventDefault()
      }}
    >
      {!composing ? view.ranges.length ? (
        <>
          <button type="button" disabled={readOnly || !active || present.exiting} onClick={() => begin('comment')}>
            <ChatIcon width={13} height={13} />
            {t('comment')}
          </button>
          <button type="button" disabled={readOnly || !active || present.exiting} onClick={() => begin('change')}>
            <PencilIcon width={13} height={13} />
            {t('suggestChange')}
          </button>
          {scope && <p className="sel-note">{scope}</p>}
        </>
      ) : <p className="sel-note">{exclusionMessage(t, view.excluded)}</p> : (
        <div className="sel-composer">
          {(readOnly || source !== view.source) && <p role="status">{t(readOnly ? 'editingPaused' : 'draftSelectionChanged')}</p>}
          {scope && <p className="sel-note">{scope}</p>}
          {composing === 'comment' && view.ranges.length > 1 && <p className="sel-note">{t('commentFirstPart')}</p>}
          {composing === 'comment' ? <textarea readOnly={readOnly}
            autoFocus
            {...ime.inputProps}
            rows={3}
            placeholder={t('commentPlaceholder')}
            title={t('commentHint')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={composerKey}
          /> : <>
            <p>{t('changeHint')}</p>
            {replacements.map((replacement, index) => <label key={index}>
              {t('replacement')}{replacements.length > 1 ? ` ${index + 1}` : ''}
              <textarea autoFocus={index === 0} readOnly={readOnly} rows={3}
                {...ime.inputProps}
                value={replacement} onChange={(event) => setReplacements((current) =>
                  current.map((value, i) => i === index ? event.target.value : value))}
                onKeyDown={composerKey} />
            </label>)}
          </>}
          {refusal && <p role="alert">{t(refusal)}</p>}
          <div className="sel-composer-actions">
            <button type="button" onClick={() => {
              cancelSelectionCheck()
              composingRef.current = false
              setComposing(null)
            }}>
              {t('cancel')}
            </button>
            <button type="button" className="btn-primary btn-compact" disabled={!canSubmit} onClick={submit}>
              {t(composing === 'comment' ? 'comment' : 'suggestChange')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
