import { useDraftGuard, useDraftState } from '../../review/drafts'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
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

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onSelectionChange = (): void => {
      if (composingRef.current) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          setActive(null)
          return
        }
        const range = sel.getRangeAt(0)
        const container = containerRef.current
        if (!container || !container.contains(range.commonAncestorContainer)) {
          setActive(null)
          return
        }
        const res = rangeToSourceRanges(range, source, spans)
        if ('error' in res) {
          setActive(null)
          return
        }
        const rect = range.getBoundingClientRect()
        setActive({ source, ranges: res.ranges, rect: { top: rect.top, left: rect.left, width: rect.width } })
      }, 120)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (timer) clearTimeout(timer)
    }
  }, [containerRef, source, spans])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (ime.isComposing(e)) return
      if (e.key === 'Escape') {
        // Leave Escape to active settings or dialog overlays.
        if (document.querySelector('.settings-panel, .close-dialog[open]')) return
        setComposing(null)
        setComment('')
        setActive(null)
      }
    }
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0) return
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        setActive((prev) => (prev ? { ...prev, rect: { top: rect.top, left: rect.left, width: rect.width } } : prev))
      })
    }
    const scrollTarget = documentViewport().target
    if (active) {
      window.addEventListener('keydown', onKey)
      scrollTarget.addEventListener('scroll', onScroll, { passive: true })
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      scrollTarget.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [active])

  const meaningful = composing === 'comment' ? !!comment.trim() : composing === 'change' &&
    !!active && replacements.some((text, index) => text !== active.ranges[index]?.text)
  useDraftGuard('selection', t(composing === 'change' ? 'suggestChange' : 'comment'), meaningful,
    () => { requestAnimationFrame(() => toolbarRef.current?.querySelector('textarea')?.focus()) },
    () => { setComment(''); setReplacements([]); setComposing(null); setActive(null) })

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
  if (!present.mounted || !view) return null

  const finish = (edits: TextEdit[]): void => {
    if (readOnly) return
    onEdit(edits)
    window.getSelection()?.removeAllRanges()
    setActive(null)
    setComposing(null)
    setComment('')
  }
  const changes = composing === 'change' ? changeEdits(view.ranges, replacements) : []
  const canSubmit = source === view.source && !readOnly && (composing === 'comment' ? !!comment.trim() : !!changes?.length)
  const submit = (): void => {
    if (!canSubmit) return
    finish(composing === 'comment' ? commentEdits(view.ranges, authorTag, comment) : changes!)
  }
  const composerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (ime.isComposing(e.nativeEvent)) { e.stopPropagation(); return }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
    else if (e.key === 'Escape') {
      setComposing(null)
      setComment('')
      setActive(null)
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
          <button type="button" disabled={readOnly} onClick={() => setComposing('comment')}>
            <ChatIcon width={13} height={13} />
            {t('comment')}
          </button>
          <button type="button" disabled={readOnly} onClick={() => { setReplacements(view.ranges.map((range) => range.text)); setComposing('change') }}>
            <PencilIcon width={13} height={13} />
            {t('suggestChange')}
          </button>
        </>
      ) : (
        <div className="sel-composer">
          {(readOnly || source !== view.source) && <p role="status">{t(readOnly ? 'editingPaused' : 'draftSelectionChanged')}</p>}
          {composing === 'comment' ? <textarea readOnly={readOnly}
            autoFocus
            ref={ime.textareaRef}
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
                ref={ime.textareaRef} onCompositionStart={ime.onCompositionStart}
                onCompositionEnd={ime.onCompositionEnd} onBlur={ime.onBlur}
                value={replacement} onChange={(event) => setReplacements((current) =>
                  current.map((value, i) => i === index ? event.target.value : value))}
                onKeyDown={composerKey} />
            </label>)}
            {changes === null && <p role="alert">{t('changeInvalid')}</p>}
          </>}
          <div className="sel-composer-actions">
            <button type="button" onClick={() => setComposing(null)}>
              {t('cancel')}
            </button>
            <button type="button" className="primary" disabled={!canSubmit} onClick={submit}>
              {t(composing === 'comment' ? 'comment' : 'suggestChange')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
