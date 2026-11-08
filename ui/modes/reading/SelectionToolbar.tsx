import { READING_LAYOUT_EVENT } from '../../app/reading-space'
import { escapeOwner } from '../../app/constants'
import { useDraftGuard, useDraftState } from '../../review/drafts'
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react'
import { useOverlay } from '../../app/overlayStore'
import type { Analysis } from '../../../document/markdown/analyze'
import type { TextEdit } from '../../../document/types'
import { useT, type MsgKey } from '../../i18n'
import { ChatIcon, PencilIcon } from '../../icons'
import { announce } from '../../app/Notifications'
import { EXIT_MS_FALLBACK, usePresence } from '../../util/presence'
import { clearHighlight, paintHighlight } from '../../util/highlights'
import { useCompositionGuard } from '../../util/composition'
import { rootMs } from '../../util/css-tokens'
import { mapSelection, type ExcludedSegment, type ExclusionReason, type SelectedFragment, type SelRange } from './selection'
import { documentViewport, readingLine } from '../../util/scroll'
import { commentBodyFits, commentVerdict, changeVerdict, type MarkVerdict } from './marks'

/** The toolbar's size before it is measured, and where layout reports none. */
const FALLBACK_SIZE = { width: 260, height: 44 }
/** The CSS highlight that keeps a composer's target looking selected; see `::highlight(selection-target)`. */
export const SELECTION_TARGET_HIGHLIGHT = 'selection-target'
/** One notice explains the latest trimmed selection; a later trim replaces it. */
export const SELECTION_TRIM_NOTICE = 'selection-trim'

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
  /** The rendered text `ranges` cover, in document order. */
  fragments: Range[]
  rect: { top: number; left: number; width: number; bottom: number }
}

/** A mapped selection, its markable parts, and the selected text it leaves out. */
interface Reading { active: Active; parts: SelectedFragment[]; excluded: ExcludedSegment[] }

const REASON_MESSAGES: Record<ExclusionReason, MsgKey> = {
  'existing-mark': 'selectionExistingMark',
  'generated-text': 'selectionGeneratedText',
  'opaque-block': 'selectionOpaqueBlock',
  'partial-code': 'selectionPartialCode',
  'partial-link': 'selectionPartialLink',
  'multiple-translated-blocks': 'selectionTranslatedBlocks',
  'no-provenance': 'selectionUnmatched',
}

/** Joins sentences, spacing them unless one ends in a full-width stop. */
function sentences(parts: readonly string[]): string {
  return parts.reduce((text, part) => !text ? part : /[。！？]$/.test(text) ? text + part : `${text} ${part}`, '')
}

/**
 * Why a selection was trimmed, to its markable text or to the first of several markable parts, or
 * why none of it can be marked: one sentence per distinct reason, in the order the selection meets
 * them.
 */
function exclusionNotice(t: (key: MsgKey) => string, excluded: readonly ExcludedSegment[],
  outcome: 'trimmed' | 'first' | 'none'): string {
  const reasons = [...new Set(excluded.map((segment) => segment.reason))].map((reason) => t(REASON_MESSAGES[reason]))
  const lead = outcome === 'trimmed' ? [t('selectionTrimmed')] : outcome === 'first' ? [t('selectionTrimmedFirst')] : []
  return sentences([...lead, ...reasons])
}

const rectOf = (range: Range): Active['rect'] => {
  const rect = range.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, bottom: rect.bottom }
}

function sameRange(a: Range, b: Range): boolean {
  return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0
}

export function SelectionToolbar({ containerRef, source, analysis, authorTag, onEdit, readOnly = false }: Props) {
  const t = useT()
  /** The current interface language, for checks queued by an effect that outlives a switch. */
  const translate = useRef(t)
  translate.current = t
  const ime = useCompositionGuard()
  const [active, setActive] = useDraftState<Active | null>('selection:active', null)
  const [composing, setComposing] = useDraftState<'comment' | 'change' | null>('selection:kind', null)
  const [replacements, setReplacements] = useDraftState<string[]>('selection:replacements', [])
  const [comment, setComment] = useDraftState('selection:comment', '')
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [toolbarSize, setToolbarSize] = useState(FALLBACK_SIZE)
  const composingRef = useRef(false)
  composingRef.current = composing !== null
  const lastActive = useRef<Active | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const selectedRange = useRef<Range | null>(null)
  /**
   * The document selection this toolbar last set while trimming. The selection changes that echo
   * it are not new selections, so they neither map again nor notify again.
   */
  const applied = useRef<Range | null>(null)
  /**
   * Whether a pointer button or Shift is extending the selection; a partial one waits for release.
   * A press whose release never arrives, as when a context menu takes it, ends with that menu or
   * with the next pointer event that reports no button held.
   */
  const held = useRef({ pointer: false, shift: false, awaiting: false })
  /** Set when the source changes under a shown toolbar, so the next check re-reads its selection. */
  const reread = useRef(false)
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelSelectionCheck = (): void => {
    if (selectionTimer.current !== null) clearTimeout(selectionTimer.current)
    selectionTimer.current = null
  }
  const dismiss = (): void => {
    cancelSelectionCheck()
    composingRef.current = false
    applied.current = null
    setComposing(null)
    setComment('')
    setReplacements([])
    setActive(null)
  }
  /** The current selection's coverage; null when nothing is selected, undefined while its DOM is outdated. */
  const readSelection = (): Reading | null | undefined => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !containerRef.current) return null
    const range = sel.getRangeAt(0)
    const mapped = mapSelection(range, source, analysis, containerRef.current)
    if (mapped.status === 'inactive') return null
    if (mapped.status === 'outdated') return undefined
    selectedRange.current = range.cloneRange()
    return { excluded: mapped.excluded, parts: mapped.fragments, active: { source: mapped.revision,
      ranges: mapped.segments, fragments: mapped.fragments.map((part) => part.range), rect: rectOf(range) } }
  }
  /** Whether the document selection is still the one this toolbar set. */
  const echoesTrim = (): boolean => {
    const own = applied.current
    const sel = window.getSelection()
    if (!own || !sel) return false
    return sel.rangeCount === 1 && sameRange(sel.getRangeAt(0), own)
  }
  /**
   * Narrows a partial selection to what will be marked and explains the trim once. The first
   * markable fragment becomes the document selection, which holds one range, and later fragments
   * are dropped with their segments, so both actions act on exactly what is visibly selected.
   * Returns the toolbar's state, or null when nothing can be marked.
   */
  const trim = ({ active: next, parts, excluded }: Reading): Active | null => {
    if (!excluded.length) return next
    const [first] = parts
    const ranges = first?.segments ?? []
    const outcome = !first ? 'none' : parts.length > 1 ? 'first' : 'trimmed'
    announce(SELECTION_TRIM_NOTICE, exclusionNotice(translate.current, excluded, outcome))
    if (!first) return null
    const fragment = first.range
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(fragment.cloneRange())
    applied.current = fragment.cloneRange()
    selectedRange.current = fragment.cloneRange()
    return { ...next, ranges, fragments: [fragment], rect: rectOf(fragment) }
  }

  useEffect(() => {
    const check = (): void => {
      selectionTimer.current = null
      // Focus entering a composer may collapse the browser selection after this check was queued.
      if (composingRef.current) return
      if (reread.current) reread.current = false
      else if (echoesTrim()) return
      applied.current = null
      // An outdated read waits for the render that follows its source change, which reads again.
      const next = readSelection()
      if (next === undefined) return
      // Trimming under a drag or Shift-extension would fight it; the trim waits for release.
      if (next?.excluded.length && (held.current.pointer || held.current.shift)) {
        held.current.awaiting = true
        setActive(null)
        return
      }
      setActive(next ? trim(next) : null)
    }
    const onSelectionChange = (): void => {
      cancelSelectionCheck()
      if (composingRef.current) return
      selectionTimer.current = setTimeout(check, 120)
    }
    // Releasing the pointer or Shift checks a partial selection that waited for it.
    const state = held.current
    const settle = (): void => {
      if (state.pointer || state.shift || !state.awaiting) return
      state.awaiting = false
      onSelectionChange()
    }
    const press = (event: PointerEvent): void => { if (event.button === 0) state.pointer = true }
    const lift = (): void => { state.pointer = false; settle() }
    const move = (event: PointerEvent): void => { if (state.pointer && event.buttons === 0) lift() }
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Shift') return
      state.shift = event.type === 'keydown'
      settle()
    }
    const blur = (): void => { state.pointer = false; state.shift = false; settle() }
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerdown', press, true)
    window.addEventListener('pointerup', lift, true)
    window.addEventListener('pointercancel', lift, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('contextmenu', lift, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    window.addEventListener('blur', blur)
    // A shown toolbar's selection can survive a source change without a new event; re-read it.
    if (activeRef.current) { reread.current = true; onSelectionChange() }
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerdown', press, true)
      window.removeEventListener('pointerup', lift, true)
      window.removeEventListener('pointercancel', lift, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('contextmenu', lift, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
      window.removeEventListener('blur', blur)
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
        setActive((prev) => (prev ? { ...prev, rect: { top: rect.top, left: rect.left, width: rect.width, bottom: rect.bottom } } : prev))
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

  const exitMs = useMemo(() => rootMs('--dur-fast', EXIT_MS_FALLBACK), [])
  // Preserve the last position while the toolbar exits.
  const present = usePresence(!!active, exitMs)
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const measure = () => {
      const { width, height } = toolbar.getBoundingClientRect()
      setToolbarSize((current) => width === current.width && height === current.height ? current
        : { width: width || FALLBACK_SIZE.width, height: height || FALLBACK_SIZE.height })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(toolbar)
    return () => observer?.disconnect()
  }, [present.mounted, composing])
  // Focus moving into a composer stops the browser painting the document selection, so its
  // fragments keep a selection-colored highlight until the composer closes; the reading DOM stays
  // untouched.
  useLayoutEffect(() => {
    if (!active || !composing) return
    const ranges = active.fragments.filter((range) => !range.collapsed && range.commonAncestorContainer.isConnected)
    if (!ranges.length) return
    paintHighlight(SELECTION_TARGET_HIGHLIGHT, ranges)
    return () => clearHighlight(SELECTION_TARGET_HIGHLIGHT)
    // A new capture replaces `fragments`; scrolling only moves `rect`, which needs no repaint.
  }, [composing, active?.fragments])
  // Find opening or closing moves the ceiling below; re-render once its bar is in the DOM.
  const findOpen = useOverlay((s) => s.open === 'find')
  const [, relayout] = useReducer((n: number) => n + 1, 0)
  useLayoutEffect(relayout, [findOpen])
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
    // A pending selection change is read now, unless it only echoes the toolbar's own trim.
    const pending = selectionTimer.current !== null && !echoesTrim() ? readSelection() : null
    if (pending) applied.current = null
    const target = pending ? trim(pending) : active
    cancelSelectionCheck()
    if (!target?.ranges.length) { setActive(target); return }
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
  const composerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (ime.isComposing(e.nativeEvent) || e.defaultPrevented) { e.stopPropagation(); return }
    // A comment posts on Enter, with Shift+Enter for a new line; suggested text keeps Enter for
    // line breaks, since it edits the document. Cmd/Ctrl+Enter submits either. An Enter that cannot
    // submit still inserts nothing in a comment.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (composing === 'comment' && !e.shiftKey && !e.altKey))) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      dismiss()
    }
    e.stopPropagation()
  }

  const left = Math.max(8, Math.min(view.rect.left + view.rect.width / 2 - toolbarSize.width / 2,
    window.innerWidth - toolbarSize.width - 8))
  // The toolbar never covers the document controls or Find; without room above its selection it opens below.
  const find = document.querySelector('.find-bar')?.getBoundingClientRect()
  const besideFind = !!find && left < find.right && left + toolbarSize.width > find.left
  const ceiling = Math.max(readingLine(), besideFind ? find.bottom : 0) + 8
  const above = view.rect.top - toolbarSize.height - 8
  const top = above >= ceiling ? above
    : Math.max(ceiling, Math.min(view.rect.bottom + 8, window.innerHeight - toolbarSize.height - 8))

  return (
    <div ref={toolbarRef}
      className={`sel-toolbar${present.exiting ? ' closing' : ''}`}
      style={{ top, left }}
      onMouseDown={(e) => {
        // Preserve the document selection without stealing the composer caret.
        if ((e.target as HTMLElement).tagName !== 'TEXTAREA') e.preventDefault()
      }}
    >
      {!composing ? (
        <>
          <button type="button" disabled={readOnly || !active || present.exiting} onClick={() => begin('change')}>
            <PencilIcon width={13} height={13} />
            {t('suggestChange')}
          </button>
          <button type="button" disabled={readOnly || !active || present.exiting} onClick={() => begin('comment')}>
            <ChatIcon width={13} height={13} />
            {t('comment')}
          </button>
        </>
      ) : (
        <div className="sel-composer">
          {(readOnly || source !== view.source) && <p role="status">{t(readOnly ? 'editingPaused' : 'draftSelectionChanged')}</p>}
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
          /> : replacements.map((replacement, index) => {
            // One field needs no label; fields for a selection spanning blocks are numbered in order.
            const part = replacements.length > 1 ? t('changePart').replace('{index}', String(index + 1))
              .replace('{total}', String(replacements.length)) : null
            return <label key={index}>
              {part && <span className="sel-part">{part}</span>}
              <textarea autoFocus={index === 0} readOnly={readOnly} rows={3}
                {...ime.inputProps}
                aria-label={part ? undefined : t('suggestChange')}
                placeholder={t('changeDeletePlaceholder')}
                value={replacement} onChange={(event) => setReplacements((current) =>
                  current.map((value, i) => i === index ? event.target.value : value))}
                onKeyDown={composerKey} />
            </label>
          })}
          {refusal && <p role="alert">{t(refusal)}</p>}
          <div className="sel-composer-actions">
            <button type="button" className="btn-compact" onClick={() => {
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
