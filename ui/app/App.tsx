import { APP_NAME } from './constants'
import { useEffect, type ReactNode } from 'react'
import { Tooltip } from 'radix-ui'
import { useT } from '../i18n'
import { GrainOverlay, ThemeEffects } from '../theme/ThemeProvider'
import { useConfig } from './configStore'
import { Navigator, useIsNarrow } from './Navigator'
import { useNav } from './navStore'
import { useRoute } from './route'
import { registerDocumentLifecycle } from '../documents/documentLifecycle'
import { SessionView } from './SessionView'

export function App({ home, onboarding, native = false }: {
  home?: ReactNode; onboarding?: ReactNode; native?: boolean
}) {
  const load = useConfig((s) => s.load)
  const saveFailed = useConfig((s) => s.saveFailed)
  const t = useT()
  useEffect(() => {
    if (!saveFailed) return
    const timer = setTimeout(() => useConfig.getState().clearFailure(), 8000)
    return () => clearTimeout(timer)
  }, [saveFailed])
  const route = useRoute()
  const awaitingNativeSetup = native && onboarding != null
  useEffect(() => {
    if (awaitingNativeSetup) return
    if (native) void load().catch(() => {})
    else void load()
  }, [load, native, awaitingNativeSetup])

  useEffect(() => native ? undefined : registerDocumentLifecycle(), [native])

  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <ThemeEffects />
      {onboarding ?? <>
        {route.kind === 'doc' && (
          <AppFrame>
            <SessionView key={route.sessionId} sessionId={route.sessionId} />
          </AppFrame>
        )}
        {route.kind === 'home' && (home ?? <HomeView />)}
      </>}
      {saveFailed && <div className="toast toast-error" role="alert">{t('configSaveFailed')}</div>}
      <GrainOverlay />
    </Tooltip.Provider>
  )
}

function AppFrame({
  children,
}: {
  children: ReactNode
}) {
  const outlineCount = useNav((s) => s.outline.length)
  const collapsed = useNav((s) => s.collapsed)
  const narrow = useIsNarrow()
  const navPresent = outlineCount >= 2
  const withNav = navPresent && !narrow && !collapsed
  return (
    <>
      {navPresent && <Navigator />}
      <div className={`app-content${withNav ? ' with-nav' : ''}`}>{children}</div>
    </>
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
