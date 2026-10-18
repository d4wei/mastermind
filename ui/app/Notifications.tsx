import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertIcon, CrossIcon } from '../icons'
import { useT } from '../i18n'
import './Notifications.css'

const NotificationTarget = createContext<HTMLElement | null>(null)

export function Notifications({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  return <NotificationTarget.Provider value={target}>
    {children}
    <div ref={setTarget} className="notification-stack" />
  </NotificationTarget.Provider>
}

export function Notification({ children, onDismiss, error = false, compact = false }: {
  children: ReactNode; onDismiss?: () => void; error?: boolean; compact?: boolean
}) {
  const target = useContext(NotificationTarget)
  const t = useT()
  const content = <section className={`notification${compact ? ' notification-compact' : ''}`} role={error ? 'alert' : 'status'}>
    <div className="notification-content">{children}</div>
    {onDismiss && <button type="button" className="btn-ghost btn-icon notification-dismiss"
      aria-label={t('dismiss')} onClick={onDismiss}><CrossIcon /></button>}
  </section>
  return target ? createPortal(content, target) : content
}

/** A dismissed failure remains reachable without replaying the alert on every render. */
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  const [dismissed, setDismissed] = useState(false)
  const t = useT()
  if (dismissed && !error) return null
  if (dismissed) return <Notification compact>
    <button type="button" className="btn-ghost btn-icon recovery-warning"
      aria-label={t('showNotification')} title={t('showNotification')} onClick={() => setDismissed(false)}>
      <AlertIcon />
    </button>
  </Notification>
  return <Notification onDismiss={() => setDismissed(true)} error={error}>
    {children}
  </Notification>
}
