import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { rootMs } from '../util/css-tokens'
import { prefersReducedMotion } from '../util/presence'
import './Collapsible.css'

interface Props {
  open: boolean
  /** Rendered on the outer element, which exists only while the content is mounted. */
  id?: string
  className?: string
  /** Mounted only while open or collapsing; a collapsing section keeps its last open render. */
  children: ReactNode
}

type Shown = 'closed' | 'opening' | 'open'

/** The duration the card sections ease with; an unreadable token means the change is instant. */
export function revealMs(): number {
  return rootMs('--dur-base', 0)
}

/**
 * Whether a transition of the row is still running, as after one reverses mid-way; undefined where
 * animations cannot be listed.
 */
function rowMoving(element: HTMLElement): boolean | undefined {
  if (typeof element.getAnimations !== 'function') return undefined
  return element.getAnimations().some((animation) =>
    (animation as CSSTransition).transitionProperty === 'grid-template-rows' && animation.playState !== 'finished')
}

/** Closing content takes no input: its handlers belong to a render that is no longer current. */
function refuse(event: SyntheticEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * A section of a card that eases open and closed. Its grid row moves between `0fr` and `1fr`, so the
 * section's height follows its content without being measured or set, and the card around it
 * follows the section. Content mounts when the section opens. Closing content keeps its last open
 * render and stays, inert, hidden from assistive technology and refusing input, until the row's
 * transition ends or is cancelled, marked as settling to nothing (`settling.ts`); reopening it mid-collapse renders
 * the same elements live again. Content opened with the component appears without easing, and
 * reduced motion makes every change immediate.
 */
export function Collapsible({ open, id, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState<Shown>(open ? 'open' : 'closed')
  if (open && !mounted) setMounted(true)
  if (!open && shown !== 'closed') setShown('closed')
  const lastOpen = useRef(children)
  if (open) lastOpen.current = children
  const closing = !open && mounted

  useLayoutEffect(() => {
    if (!open || shown !== 'closed') return
    const duration = prefersReducedMotion() ? 0 : revealMs()
    // The row is styled closed before it opens, so the change transitions.
    void ref.current?.offsetHeight
    setShown(duration > 0 ? 'opening' : 'open')
  }, [open, shown])
  useLayoutEffect(() => {
    if (closing && (prefersReducedMotion() || revealMs() <= 0 || !ref.current)) setMounted(false)
  }, [closing])
  // A move ends with the row's own transition, not a timer: a timer can run ahead of a transition
  // that started late or paused with a hidden window. A cancelled transition ends it too, unless
  // the row still moves, since reversing mid-way cancels the transition it replaces.
  const moving = shown === 'opening' || closing
  useEffect(() => {
    const element = ref.current
    if (!moving || !element) return
    const finish = (): void => { if (open) setShown('open'); else setMounted(false) }
    const settle = (event: TransitionEvent): void => {
      if (event.target !== element || event.propertyName !== 'grid-template-rows') return
      if (event.type === 'transitioncancel' && rowMoving(element)) return
      finish()
    }
    element.addEventListener('transitionend', settle)
    element.addEventListener('transitioncancel', settle)
    // A change the row never transitioned, as when it reverted before a style update, has no event.
    if (rowMoving(element) === false) finish()
    return () => {
      element.removeEventListener('transitionend', settle)
      element.removeEventListener('transitioncancel', settle)
    }
  }, [moving, open])

  if (!open && !mounted) return null
  const state = shown === 'closed' ? '' : shown === 'opening' ? ' open' : ' open settled'
  return <div ref={ref} id={id} className={`collapsible${state}${className ? ` ${className}` : ''}`}
    inert={!open} aria-hidden={!open || undefined} data-settles-to={open ? undefined : 0}
    onKeyDownCapture={closing ? refuse : undefined} onClickCapture={closing ? refuse : undefined}>
    <div className="collapsible-content">{open ? children : lastOpen.current}</div>
  </div>
}
