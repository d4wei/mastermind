import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useDoc } from '../documents/store'
import { useT } from '../i18n'

/**
 * Contains a render failure to the document session: the file tabs and close handling, which live
 * outside it, stay mounted, and the document's Markdown remains readable. Remount it per document.
 */
export class SessionErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Document view failed to render', error, info.componentStack)
  }

  override render(): ReactNode {
    return this.state.failed ? <SessionFallback /> : this.props.children
  }
}

function SessionFallback() {
  const t = useT()
  const source = useDoc((s) => s.source)
  return <div className="session-fallback">
    <p role="alert">{t('documentRenderFailed')}</p>
    <pre className="session-fallback-source" tabIndex={0} aria-label={t('source')}>{source}</pre>
  </div>
}
