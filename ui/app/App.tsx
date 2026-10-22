import { CloseDialog } from '../desktop/CloseDialog'
import { Notifications, Notice } from './Notifications'
import { APP_NAME } from './constants'
import { Fragment, useEffect, type ReactNode } from 'react'
import { Tooltip } from 'radix-ui'
import { useT } from '../i18n'
import { ThemeEffects } from '../theme/ThemeProvider'
import { useConfig } from './configStore'
import { useRoute } from './route'
import { registerDocumentLifecycle } from '../documents/documentLifecycle'
import { TableExpansionProvider } from '../modes/reading/TableExpansion'
import { SessionView } from './SessionView'

export function App({ home, onboarding, native = false }: {
  home?: ReactNode; onboarding?: ReactNode; native?: boolean
}) {
  const load = useConfig((s) => s.load)
  const saveFailed = useConfig((s) => s.saveFailed)
  const t = useT()
  const route = useRoute()
  const awaitingNativeSetup = native && onboarding != null
  useEffect(() => {
    if (awaitingNativeSetup) return
    if (native) void load().catch(() => {})
    else void load()
  }, [load, native, awaitingNativeSetup])

  useEffect(() => native ? undefined : registerDocumentLifecycle(), [native])

  const NotificationHost = native ? Fragment : Notifications
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <NotificationHost>
      <ThemeEffects />
      {!native && <CloseDialog />}
      {onboarding ?? <>
        {route.kind === 'doc' && (
          <AppFrame>
            <SessionView key={route.sessionId} sessionId={route.sessionId} />
          </AppFrame>
        )}
        {route.kind === 'home' && (home ?? <HomeView />)}
      </>}
      {saveFailed && <Notice error>{t('configSaveFailed')}</Notice>}
      </NotificationHost>
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

function HomeView() {
  const t = useT()
  return (
    <div className="center-note">
      <h1>{APP_NAME}</h1>
      <p>
        {t('openHint')} <code>npm run dev -- &lt;file.md&gt;</code>
      </p>
    </div>
  )
}
