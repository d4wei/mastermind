import { useEffect, useRef, useState, type RefObject } from 'react'
import type { CriticSpan } from '../../../shared/critic/types'
import type { TextEdit } from '../../../shared/types'
import { useT } from '../../i18n'
import { ChatIcon, MoreIcon, StrikethroughIcon } from '../../icons'
import { useCompositionGuard } from '../../util/composition'
import { blockContentRanges, markEdits } from './selection'
import { commentEdits, deletionWrap } from './marks'

// Wrapping structural containers can break Markdown syntax; mark their text blocks instead.
const BLOCK_SELECTOR = 'p,li,h1,h2,h3,h4,h5,h6'
const HIDE_MS = 220
const FLIP_THRESHOLD = 220

interface Props {
  containerRef: RefObject<HTMLElement | null>
  source: string
  spans: readonly CriticSpan[]
  authorTag: string
  onEdit: (edits: TextEdit[]) => void
}

type Mode = 'button' | 'menu' | 'compose'

interface Active {
  block: HTMLElement
  mode: Mode
}

export function BlockActions({ containerRef, source, spans, authorTag, onEdit }: Props) {
  const t = useT()
  const ime = useCompositionGuard()
  const [active, setActive] = useState<Active | null>(null)
  const [comment, setComment] = useState('')
  const [, setTick] = useState(0) // re-measure on scroll/resize without re-anchoring
  const activeRef = useRef<Active | null>(null)
  activeRef.current = active
  const menuRef = useRef<HTMLDivElement>(null)

  // Pointer movement must not discard a partially written comment.
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    const clearHide = (): void => {
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = null
    }
    const scheduleHide = (): void => {
      clearHide()
      hideTimer = setTimeout(() => {
        if (activeRef.current && activeRef.current.mode !== 'compose') setActive(null)
      }, HIDE_MS)
    }
    const onOver = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('.block-actions')) {
        clearHide()
        return
      }
      const cur = activeRef.current
      if (cur?.mode === 'compose') return
      const block = target.closest(BLOCK_SELECTOR) as HTMLElement | null
      const inDoc = block && containerRef.current?.contains(block)
      if (cur?.mode === 'menu') {
        if (inDoc && block === cur.block) clearHide()
        else scheduleHide()
        return
      }
      if (inDoc) {
        clearHide()
        if (block !== cur?.block) setActive({ block, mode: 'button' })
      } else {
        scheduleHide()
      }
    }
    document.addEventListener('mouseover', onOver)
    return () => {
      document.removeEventListener('mouseover', onOver)
      clearHide()
    }
  }, [containerRef])

  useEffect(() => {
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setTick((n) => n + 1)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (ime.isComposing(e)) return
      if (e.key === 'Escape' && activeRef.current && activeRef.current.mode !== 'button') {
        setActive(null)
        setComment('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (active?.mode === 'menu') menuRef.current?.querySelector('button')?.focus()
  }, [active?.mode])

  // the captured block can detach across a re-render (a disk reload swaps
  // the DOM); don't position against a stale node — the next hover re-anchors.
  if (!active || !active.block.isConnected) return null

  const close = (): void => {
    setActive(null)
    setComment('')
  }
  const applyDeletion = (): void => {
    const ranges = blockContentRanges(active.block, source, spans)
    if (ranges.length) onEdit(markEdits(ranges, deletionWrap))
    close()
  }
  const applyComment = (): void => {
    if (!comment.trim()) return
    const ranges = blockContentRanges(active.block, source, spans)
    if (ranges.length) onEdit(commentEdits(ranges, authorTag, comment))
    close()
  }

  const rect = active.block.getBoundingClientRect()
  const top = Math.max(8, Math.min(rect.top + 2, window.innerHeight - 40))
  const left = Math.max(8, Math.min(rect.right + 8, window.innerWidth - 32))
  const flipUp = rect.top > window.innerHeight - FLIP_THRESHOLD

  return (
    <div
      className={`block-actions${flipUp ? ' flip-up' : ''}`}
      style={{ top, left }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== 'TEXTAREA') e.preventDefault()
      }}
    >
      <button
        type="button"
        className="block-trigger"
        aria-label={t('blockActions')}
        aria-haspopup="true"
        aria-expanded={active.mode !== 'button'}
        title={t('blockActions')}
        onClick={() => setActive({ block: active.block, mode: active.mode === 'button' ? 'menu' : 'button' })}
      >
        <MoreIcon />
      </button>
      {active.mode === 'menu' && (
        <div className="block-menu" role="group" aria-label={t('blockActions')} ref={menuRef}>
          <button type="button" onClick={() => setActive({ block: active.block, mode: 'compose' })}>
            <ChatIcon width={13} height={13} />
            {t('comment')}
          </button>
          <button type="button" onClick={applyDeletion}>
            <StrikethroughIcon width={13} height={13} />
            {t('suggestDeletion')}
          </button>
        </div>
      )}
      {active.mode === 'compose' && (
        <div className="block-compose">
          <textarea
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
            onKeyDown={(e) => {
              if (ime.isComposing(e.nativeEvent)) { e.stopPropagation(); return }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && comment.trim()) applyComment()
              else if (e.key === 'Escape') close()
              e.stopPropagation()
            }}
          />
          <div className="block-compose-actions">
            <button type="button" onClick={close}>
              {t('cancel')}
            </button>
            <button type="button" className="primary" disabled={!comment.trim()} onClick={applyComment}>
              {t('comment')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
