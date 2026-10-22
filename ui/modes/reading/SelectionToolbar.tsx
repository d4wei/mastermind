import { READING_LAYOUT_EVENT } from '../../app/reading-space'
import { escapeOwner } from '../../app/constants'
import { useDraftGuard, useDraftState } from '../../review/drafts'
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { CriticSpan } from '../../../document/critic/types'
import type { TextEdit } from '../../../document/types'
import { useT } from '../../i18n'
import { ChatIcon, PencilIcon } from '../../icons'
import { usePresence } from '../../util/presence'
import { useCompositionGuard } from '../../util/composition'
import { rangeToSourceRanges, type SelRange } from './selection'
import { documentViewport } from '../../util/scroll'
import { commentEdits, changeEdits } from './marks'

const EXIT_MS = 120

interface Props {
  readOnly?: boolean
  containerRef: RefObject<HTMLElement | null>
  source: string
  spans: readonly CriticSpan[]
  authorTag: string
  onEdit: (edits: TextEdit[]) => void
}

interface Active {
  source: string
  /** Editable fragments in source order; existing marks and unmappable text stay outside them. */
  ranges: SelRange[]
  rect: { top: number; left: number; width: number }
}

export function SelectionToolbar({ containerRef, source, spans, authorTag, onEdit, readOnly = false }: Props) {
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
  const readSelection = (): Active | null => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
    const range = sel.getRangeAt(0)
    if (!containerRef.current?.contains(range.commonAncestorContainer)) return null
    const res = rangeToSourceRanges(range, source, spans)
    if ('error' in res) return null
    selectedRange.current = range.cloneRange()
    const rect = range.getBoundingClientRect()
    return { source, ranges: res.ranges, rect: { top: rect.top, left: rect.left, width: rect.width } }
  }

  useEffect(() => {
    const onSelectionChange = (): void => {
      cancelSelectionCheck()
      if (composingRef.current) return
      selectionTimer.current = setTimeout(() => {
        selectionTimer.current = null
        // Focus entering a composer may collapse the browser selection after this check was queued.
        if (composingRef.current) return
        setActive(readSelection())
      }, 120)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    // A shown toolbar's selection can survive a source change without a new event; re-read it.
    if (activeRef.current) onSelectionChange()
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      cancelSelectionCheck()
    }
  }, [containerRef, source, spans])

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

  // Preserve the last position while the toolbar exits.
  const present = usePresence(!!active, EXIT_MS)
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
  const verify = (text: string, changes: readonly string[]): TextEdit[] | null => {
    if (!view) return []
    // The analysis spans describe only the current source; a stale view rescans its own.
    const known = source === view.source ? spans : undefined
    return composing === 'change' ? changeEdits(view.source, view.ranges, changes, known)
      : composing === 'comment' && text.trim() ? commentEdits(view.source, view.ranges, authorTag, text, known) : []
  }
  // Verifying reparses the document, so the composer's verdict follows its deferred text and is
  // kept across renders, such as scroll frames, that change none of its inputs; submission verifies
  // the final text.
  const deferredComment = useDeferredValue(comment)
  const deferredReplacements = useDeferredValue(replacements)
  const edits = useMemo(() => verify(deferredComment, deferredReplacements),
    [composing, view?.source, view?.ranges, deferredComment, deferredReplacements, source, spans, authorTag])
  if (!present.mounted || !view) return null

  const begin = (kind: 'comment' | 'change'): void => {
    if (!active || present.exiting || readOnly) return
    const target = selectionTimer.current !== null ? readSelection() ?? active : active
    cancelSelectionCheck()
    setActive(target)
    composingRef.current = true
    if (kind === 'change') setReplacements(target.ranges.map((range) => range.text))
    setComposing(kind)
  }
  const finish = (edits: TextEdit[]): void => {
    if (readOnly) return
    onEdit(edits)
    window.getSelection()?.removeAllRanges()
    dismiss()
  }
  // Null marks a draft whose insert would not reparse as the intended mark in place; it stays
  // editable but cannot submit.
  const current = source === view.source && !readOnly
  const canSubmit = current && !!edits?.length
  const submit = (): void => {
    const final = current ? verify(comment, replacements) : null
    if (final?.length) finish(final)
  }
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
      {!composing ? (
        <>
          <button type="button" disabled={readOnly || !active || present.exiting} onClick={() => begin('comment')}>
            <ChatIcon width={13} height={13} />
            {t('comment')}
          </button>
          <button type="button" disabled={readOnly || !active || present.exiting} onClick={() => begin('change')}>
            <PencilIcon width={13} height={13} />
            {t('suggestChange')}
          </button>
        </>
      ) : (
        <div className="sel-composer">
          {(readOnly || source !== view.source) && <p role="status">{t(readOnly ? 'editingPaused' : 'draftSelectionChanged')}</p>}
          {composing === 'comment' ? <textarea readOnly={readOnly}
            autoFocus
            ref={ime.ref}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onBlur={ime.onBlur}
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
                ref={ime.ref} onCompositionStart={ime.onCompositionStart}
                onCompositionEnd={ime.onCompositionEnd} onBlur={ime.onBlur}
                value={replacement} onChange={(event) => setReplacements((current) =>
                  current.map((value, i) => i === index ? event.target.value : value))}
                onKeyDown={composerKey} />
            </label>)}
          </>}
          {edits === null && <p role="alert">{t(composing === 'comment' ? 'commentInvalid' : 'changeInvalid')}</p>}
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
