import { useEffect, useRef, type ReactNode } from 'react'
import { useT } from '../i18n'
import { CrossIcon } from '../icons'

interface Props {
  title: string
  onClose: () => void
  /** Selector of the invoking control, so its own click doesn't immediately re-close the panel. */
  ignoreSelector?: string
  returnFocusSelector?: string
  children: ReactNode
}

export function SlideOver({ title, onClose, ignoreSelector, returnFocusSelector, children }: Props) {
  const t = useT()
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const panel = panelRef.current
    const previous = document.activeElement as HTMLElement | null
    const returnFocus = previous && previous !== document.body && !panel?.contains(previous) &&
      !previous.closest('[role="menu"]') ? previous :
      document.querySelector<HTMLElement>(returnFocusSelector ?? ignoreSelector ?? '.topbar-overflow')
    // Let child composers take focus before choosing the panel’s first control.
    const frame = requestAnimationFrame(() => {
      if (!panel?.contains(document.activeElement)) {
        panel?.querySelector<HTMLElement>('button:not(:disabled), input, textarea, select')?.focus({ preventScroll: true })
      }
    })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) {
        e.stopPropagation()
        onClose()
      }
    }
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        !(ignoreSelector && target.closest(ignoreSelector))
      ) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerDown)
      cancelAnimationFrame(frame)
      if (panel?.contains(document.activeElement) || document.activeElement === document.body) {
        returnFocus?.focus({ preventScroll: true })
      }
    }
  }, [onClose, ignoreSelector, returnFocusSelector])

  return (
    <div className="slide-over" role="dialog" aria-label={title} ref={panelRef}>
      <div className="slide-over-head">
        <span className="slide-over-title">{title}</span>
        <button type="button" className="btn-ghost slide-over-close" onClick={onClose} aria-label={t('close')}>
          <CrossIcon />
        </button>
      </div>
      <div className="slide-over-body">{children}</div>
    </div>
  )
}
