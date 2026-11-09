import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { AlertIcon, CrossIcon } from '../icons'
import { useT } from '../i18n'
import { rootMs } from '../util/css-tokens'
import { usePresence } from '../util/presence'
import './Notifications.css'

/**
 * How much a notification asks of the reader; `notifications.md` classifies every notice.
 * `persistent` needs action or attention and stays until dismissed or resolved; `transient`
 * informs, expires on its own, and never takes focus.
 */
export type NotificationTier = 'persistent' | 'transient'

/** A transient notice's lifetime when the theme's `--notice-dismiss` token cannot be read. */
export const NOTICE_DISMISS_FALLBACK_MS = 6000

/** A transient notice's exit fade when the theme's `--dur-base` token cannot be read. */
const NOTICE_EXIT_FALLBACK_MS = 180

/**
 * Where notices portal: persistent ones into the stack, transient ones into the stack's polite live
 * region, which exists before any notice so that screen readers announce the text added to it.
 */
const NotificationTarget = createContext<{ stack: HTMLElement; transients: HTMLElement } | null>(null)

interface Announcement { id: string; text: string; serial: number }

/** Transient notices raised by events rather than by state, such as a trimmed selection. */
export const useAnnouncements = create<{ items: Announcement[] }>(() => ({ items: [] }))
let announcementSerial = 0

/**
 * Shows `text` as a transient notification. A later announcement with the same `id` replaces it in
 * place and restarts its lifetime, so repeating an event never stacks copies.
 */
export function announce(id: string, text: string): void {
  const serial = ++announcementSerial
  useAnnouncements.setState(({ items }) => ({
    items: items.some((item) => item.id === id) ? items.map((item) => item.id === id ? { id, text, serial } : item)
      : [...items, { id, text, serial }],
  }))
}

/** Removes an announcement unless a later one with the same id replaced it meanwhile. */
function withdraw(id: string, serial: number): void {
  useAnnouncements.setState(({ items }) => ({ items: items.filter((item) => item.id !== id || item.serial !== serial) }))
}

export function Notifications({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<HTMLDivElement | null>(null)
  const [transients, setTransients] = useState<HTMLDivElement | null>(null)
  const target = useMemo(() => stack && transients ? { stack, transients } : null, [stack, transients])
  const announcements = useAnnouncements((state) => state.items)
  return <NotificationTarget.Provider value={target}>
    {children}
    {announcements.map(({ id, text, serial }) => <Notification key={id} tier="transient" restart={serial}
      onExpire={() => withdraw(id, serial)}>{text}</Notification>)}
    <div ref={setStack} className="notification-stack" data-keeps-discussion="">
      <div ref={setTransients} className="notification-transients" role="status" aria-live="polite" />
    </div>
  </NotificationTarget.Provider>
}

/** Places a notice in its tier's part of the stack, or in place outside a `Notifications` provider. */
function InStack({ tier, children }: { tier: NotificationTier; children: ReactNode }) {
  const target = useContext(NotificationTarget)
  return target ? createPortal(children, tier === 'transient' ? target.transients : target.stack) : children
}

type NotificationProps = { children: ReactNode } & (
  /** `error` announces assertively; `onDismiss` adds the close control. */
  | { tier: 'persistent'; onDismiss?: () => void; error?: boolean }
  /** `onExpire` runs once the notice has left; a changed `restart` value restarts its lifetime. */
  | { tier: 'transient'; onExpire: () => void; restart?: unknown })

export function Notification(props: NotificationProps) {
  return <InStack tier={props.tier}>
    {props.tier === 'transient' ? <TransientNotification {...props} /> : <PersistentNotification {...props} />}
  </InStack>
}

function PersistentNotification({ children, onDismiss, error = false }: Extract<NotificationProps, { tier: 'persistent' }>) {
  const t = useT()
  return <section className="notification notification-persistent" role={error ? 'alert' : 'status'}>
    <AlertIcon className="notification-icon" />
    <div className="notification-content">{children}</div>
    {onDismiss && <button type="button" className="btn-ghost btn-icon notification-dismiss"
      aria-label={t('dismiss')} title={t('dismiss')} onClick={onDismiss}><CrossIcon /></button>}
  </section>
}

/**
 * The notice's lifetime pauses while it is hovered or holds focus; once the lifetime ends, its exit
 * fade runs to completion regardless, so a notice that is fading out always leaves.
 */
function TransientNotification({ children, onExpire, restart }: Extract<NotificationProps, { tier: 'transient' }>) {
  const [open, setOpen] = useState(true)
  // Each restart remounts the text so the live region announces it again, even when unchanged.
  const [shown, setShown] = useState({ restart, generation: 0 })
  if (!Object.is(shown.restart, restart)) setShown({ restart, generation: shown.generation + 1 })
  const [exitMs] = useState(() => rootMs('--dur-base', NOTICE_EXIT_FALLBACK_MS))
  const { mounted, exiting } = usePresence(open, exitMs)
  const expire = useRef(onExpire)
  expire.current = onExpire
  const clock = useRef<{ timer: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number;
    hovered: boolean; focused: boolean }>({ timer: null, remaining: 0, startedAt: 0, hovered: false, focused: false })
  const pause = (): void => {
    const state = clock.current
    if (state.timer === null) return
    clearTimeout(state.timer)
    state.timer = null
    state.remaining = Math.max(0, state.remaining - (Date.now() - state.startedAt))
  }
  const resume = (): void => {
    const state = clock.current
    if (state.timer !== null || state.hovered || state.focused || state.remaining <= 0) return
    state.startedAt = Date.now()
    state.timer = setTimeout(() => { state.timer = null; state.remaining = 0; setOpen(false) }, state.remaining)
  }
  // Each restart grants the full lifetime again, still paused while the reader holds the notice.
  useEffect(() => {
    const state = clock.current
    setOpen(true)
    if (state.timer !== null) clearTimeout(state.timer)
    state.timer = null
    state.remaining = rootMs('--notice-dismiss', NOTICE_DISMISS_FALLBACK_MS)
    resume()
    return () => { if (state.timer !== null) clearTimeout(state.timer); state.timer = null }
  }, [restart])
  useEffect(() => { if (!mounted) expire.current() }, [mounted])
  if (!mounted) return null
  return <section className={`notification notification-transient${exiting ? ' leaving' : ''}`}
    onPointerEnter={() => { clock.current.hovered = true; pause() }}
    onPointerLeave={() => { clock.current.hovered = false; resume() }}
    onFocus={() => { clock.current.focused = true; pause() }}
    onBlur={(event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      clock.current.focused = false
      resume()
    }}>
    <div key={shown.generation} className="notification-content">{children}</div>
  </section>
}

/** A dismissed persistent notice's icon-only control, which reopens it. */
export function NotificationRecall({ label, title, onOpen }: { label: string; title: string; onOpen: () => void }) {
  return <InStack tier="persistent">
    <section className="notification notification-recall">
      <button type="button" className="btn-ghost btn-icon recovery-warning" aria-label={label} title={title} onClick={onOpen}>
        <AlertIcon />
      </button>
    </section>
  </InStack>
}

/**
 * A notice that manages its own dismissal. A dismissed persistent failure remains reachable through
 * its recall control without replaying the alert on every render; a transient notice unmounts its
 * content once it expires, until the parent mounts it again.
 */
export function Notice({ children, tier }: { children: ReactNode; tier: NotificationTier }) {
  const [closed, setClosed] = useState(false)
  const t = useT()
  if (closed && tier === 'transient') return null
  if (closed) return <NotificationRecall label={t('showNotification')} title={t('showNotification')}
    onOpen={() => setClosed(false)} />
  return tier === 'transient' ? <Notification tier="transient" onExpire={() => setClosed(true)}>{children}</Notification>
    : <Notification tier="persistent" error onDismiss={() => setClosed(true)}>{children}</Notification>
}
