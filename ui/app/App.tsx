import { Notice } from './Notifications'
import { useEffect, type ReactNode } from 'react'
import { Tooltip } from 'radix-ui'
import { useT } from '../i18n'
import { ThemeEffects } from '../theme/ThemeProvider'
import { useConfig } from './configStore'
import { useRoute } from './route'
import { TableExpansionProvider } from '../modes/reading/TableExpansion'
import { SessionErrorBoundary } from './SessionErrorBoundary'
import { SessionView } from './SessionView'

/** Renders inside NativeReviewer, which provides the notification surface, close dialog, and home view. */
export function App({ onboarding }: { onboarding?: ReactNode }) {
  const load = useConfig((s) => s.load)
  const saveFailed = useConfig((s) => s.saveFailed)
  const t = useT()
  const route = useRoute()
  const awaitingSetup = onboarding != null
  useEffect(() => {
    if (awaitingSetup) return
    void load().catch(() => {})
  }, [load, awaitingSetup])

  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <ThemeEffects />
      {onboarding ?? (route.kind === 'doc' && (
        <AppFrame>
          <SessionErrorBoundary key={route.sessionId}>
            <SessionView sessionId={route.sessionId} />
          </SessionErrorBoundary>
        </AppFrame>
      ))}
      {saveFailed && <Notice error>{t('configSaveFailed')}</Notice>}
    </Tooltip.Provider>
  )
}

function AppFrame({
  children,
}: {
  children: ReactNode
}) {
  return (
    <TableExpansionProvider>
      <div className="app-content">{children}</div>
    </TableExpansionProvider>
  )
}
