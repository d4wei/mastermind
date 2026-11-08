import { useEffect, useState, type ReactNode } from 'react'
import { prefersReducedMotion } from '../util/presence'
import './LoadingState.css'

/** How long a wait lasts before its indicator appears, so a fast load never flashes it. */
export const LOADING_DELAY_MS = 300

/**
 * A transitional state centered in the window: a small indeterminate ring and its label, shown only
 * once the wait has lasted `delayMs`. Under reduced motion the ring is drawn but does not turn.
 */
export function LoadingState({ label, delayMs = LOADING_DELAY_MS }: { label: string; delayMs?: number }) {
  const [shown, setShown] = useState(delayMs <= 0)
  useEffect(() => {
    if (shown) return
    const timer = setTimeout(() => setShown(true), delayMs)
    return () => clearTimeout(timer)
  }, [shown, delayMs])
  const animated = !prefersReducedMotion()
  return <div className="state-note" role="status">
    {shown && <div className={`state-note-body${animated ? ' state-note-enter' : ''}`}>
      <span className={`loading-spinner${animated ? ' loading-spinner-turning' : ''}`} aria-hidden="true" />
      <span>{label}</span>
    </div>}
  </div>
}

/** A static state at the same position as `LoadingState`, for notes that are not waiting on anything. */
export function StateNote({ children, role }: { children: ReactNode; role?: 'status' | 'alert' }) {
  return <div className="state-note" role={role}>
    <div className="state-note-body state-note-text">{children}</div>
  </div>
}
