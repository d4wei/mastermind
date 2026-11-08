import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cssMs } from '../util/css-tokens'
import { prefersReducedMotion, usePresence } from '../util/presence'
import './Collapsible.css'

interface Props {
  open: boolean
  /** Rendered on the outer element, which exists only while the content is mounted. */
  id?: string
  className?: string
  /** Mounted only while open or collapsing. */
  children: ReactNode
}

type Shown = 'closed' | 'opening' | 'open'

/** The token the stylesheet transitions with; unreadable means the transition is instant too. */
function revealMs(): number {
  return cssMs(getComputedStyle(document.documentElement), '--dur-base') ?? 0
}

/**
 * A section of a card that eases open and closed. Its grid row moves between `0fr` and `1fr`, so the
 * section's height follows its content without being measured or set, and the card around it
 * follows the section. Content mounts when the section opens and stays, inert and hidden from
 * assistive technology, until the collapse finishes. Content opened with the component appears
 * without easing, and reduced motion makes every change immediate.
 */
export function Collapsible({ open, id, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Read when `open` flips, so the presence timer matches the stylesheet's current duration.
  const exitMs = useMemo(() => open ? 0 : revealMs(), [open])
  const { mounted } = usePresence(open, exitMs)
  const [shown, setShown] = useState<Shown>(open ? 'open' : 'closed')
  if (!open && shown !== 'closed') setShown('closed')

  useLayoutEffect(() => {
    if (!open || shown !== 'closed') return
    const duration = prefersReducedMotion() ? 0 : revealMs()
    // The row is styled closed before it opens, so the change transitions.
    void ref.current?.offsetHeight
    setShown(duration > 0 ? 'opening' : 'open')
  }, [open, shown])
  // Clipping ends with the row's own transition, not a timer: a timer can run ahead of a transition
  // that started late or paused with a hidden window, and the content would spill past the row.
  // Cancellation does not settle it, since reopening mid-collapse cancels the closing transition.
  useEffect(() => {
    const element = ref.current
    if (shown !== 'opening' || !element) return
    const settle = (event: TransitionEvent): void => {
      if (event.target === element && event.propertyName === 'grid-template-rows') setShown('open')
    }
    element.addEventListener('transitionend', settle)
    return () => element.removeEventListener('transitionend', settle)
  }, [shown])

  if (!open && !mounted) return null
  const state = shown === 'closed' ? '' : shown === 'opening' ? ' open' : ' open settled'
  return <div ref={ref} id={id} className={`collapsible${state}${className ? ` ${className}` : ''}`}
    inert={!open} aria-hidden={!open || undefined}>
    <div className="collapsible-content">{children}</div>
  </div>
}
