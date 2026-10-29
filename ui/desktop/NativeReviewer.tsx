import { useTranslation } from '../translate/translationStore'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { App } from '../app/App'
import { navigate, useRoute } from '../app/route'
import { useDoc } from '../documents/store'
import { useT } from '../i18n'
import { requestFind } from '../app/overlayStore'
import { FileIcon } from '../icons'
import { FileTabs, type OpenDocument } from './FileTabs'
import { ToolbarTarget } from '../app/ToolbarTarget'
import { nativeBridge } from './bridge'
import { createCloseHandler } from './close'
import { confirmClose } from './confirm-close'
import { closeRequestedFiles, unavailable, type CloseFilesRequest, type RequestedCloseResult } from './agent-close'
import { CloseDialog } from './CloseDialog'
import { releaseDrafts } from '../review/drafts'
import { Notifications, Notice, Notification } from '../app/Notifications'
import { createHomeMotion } from './home-motion'
import { NativeSetup, systemInterfaceLanguage, type SetupSnapshot } from './NativeSetup'

interface OpeningSnapshot {
  files: OpenDocument[]
  activation_revision: number
  active_id: number | null
  opening_errors: string[]
}

// Each poll returns fresh arrays; keeping equal state unchanged spares the session tree a re-render.
const unlessEqual = <T,>(next: T) => (current: T): T => JSON.stringify(current) === JSON.stringify(next) ? current : next

export function NativeReviewer() {
  const [files, setFiles] = useState<OpenDocument[]>([])
  const closingWindow = useRef(false)
  const fileCloseCompletion = useRef<Promise<void> | null>(null)
  const activationRevision = useRef(0)
  const [openingErrors, setOpeningErrors] = useState<string[]>([])
  const [error, setError] = useState('')
  const [setup, setSetup] = useState<SetupSnapshot | null>(null)
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [setupError, setSetupError] = useState('')
  const [previewLanguage, setPreviewLanguage] = useState<SetupSnapshot['values']['uiLang']>()
  const refreshSetup = useRef<() => Promise<void>>(async () => {})
  const setupConfirmation = useRef<Promise<boolean> | null>(null)
  const documentState = useDoc()
  // The route selects the file immediately; the store's document lags it while loading or after a failed load.
  const route = useRoute()
  const id = route.kind === 'doc' ? route.sessionId : null
  const activeRoute = useRef(id)
  useLayoutEffect(() => { activeRoute.current = id }, [id])
  const answerCloseRequest = useRef<(request: CloseFilesRequest) => Promise<RequestedCloseResult[]>>(
    async ({ ids }) => unavailable(ids))
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
  const homeMotion = useRef<ReturnType<typeof createHomeMotion> | null>(null)
  const atHome = files.length === 0 && setupRequired === false
  const homeReady = useRef(false)
  // Home shows only once setup completes, and only showing home restores a faded surface.
  const setupComplete = useRef(false)
  useLayoutEffect(() => { setupComplete.current = setupRequired === false }, [setupRequired])
  useLayoutEffect(() => {
    const motion = createHomeMotion(document.getElementById('root')!)
    homeMotion.current = motion
    return () => { motion.dispose(); homeMotion.current = null }
  }, [])
  useLayoutEffect(() => {
    homeReady.current = atHome
    homeMotion.current?.show(atHome)
  }, [atHome])
  const activePath = id === null ? undefined : files.find((file) => file.id === id)?.path
  useEffect(() => {
    void nativeBridge.invoke<void>('set_window_title', {
      value: activePath ? `mastermind - ${activePath}` : 'mastermind',
    }).catch((error) => setError(String(error)))
  }, [activePath])
  useEffect(() => {
    void nativeBridge.invoke('set_find_enabled', { enabled: !!activePath && setupRequired === false && documentState.status === 'ready' })
      .catch((error) => setError(String(error)))
  }, [activePath, setupRequired, documentState.status])
  useEffect(() => {
    let disposed = false
    let stop: (() => void) | undefined
    void nativeBridge.listen('find-requested', requestFind).then((unlisten) => {
      if (disposed) unlisten()
      else stop = unlisten
    }).catch((error) => setError(String(error)))
    return () => { disposed = true; stop?.() }
  }, [])
  const language = setupRequired !== false ? previewLanguage : undefined
  const t = useT(language)
  useEffect(() => {
    let disposed = false
    let setupRevision = -1
    let refreshing = false
    const refresh = async (): Promise<void> => {
      if (refreshing || fileCloseCompletion.current || closingWindow.current) return
      refreshing = true
      try {
        const [opening, onboarding] = await Promise.allSettled([
          nativeBridge.invoke<OpeningSnapshot>('snapshot'),
          nativeBridge.invoke<SetupSnapshot>('setup_snapshot', {
            uiLangDefault: systemInterfaceLanguage(navigator.languages),
          }),
        ])
        if (disposed || fileCloseCompletion.current || closingWindow.current) return
        if (opening.status === 'fulfilled' && opening.value.activation_revision >= activationRevision.current) {
          const snapshot = opening.value
          if (snapshot.files.length > 0 && homeReady.current) {
            await homeMotion.current?.leave(true)
            if (disposed) return
          }
          for (const file of snapshot.files) if (file.language) useTranslation.getState().hint(file.id, file.language)
          setFiles(unlessEqual(snapshot.files))
          setOpeningErrors(unlessEqual(snapshot.opening_errors))
          if (snapshot.activation_revision > activationRevision.current) {
            activationRevision.current = snapshot.activation_revision
            if (snapshot.active_id !== null) navigate(`/d/${snapshot.active_id}`)
          }
        } else if (opening.status === 'rejected') setError(String(opening.reason))
        if (onboarding.status === 'fulfilled') {
          setSetupError('')
          if (onboarding.value.revision >= setupRevision) {
            setupRevision = onboarding.value.revision
            setSetup(unlessEqual<SetupSnapshot | null>(onboarding.value))
            setSetupRequired((required) => required ?? !onboarding.value.completed)
          }
        } else {
          setSetupError(String(onboarding.reason))
        }
      } catch (error) { if (!disposed) setError(String(error)) }
      finally { refreshing = false }
    }
    refreshSetup.current = refresh
    const revalidate = (): void => { useDoc.getState().notifyDiskChange() }
    window.addEventListener('focus', revalidate)
    void refresh()
    const timer = setInterval(() => { void refresh() }, 500)
    const close = createCloseHandler({ prepareToClose: async () => {
      await fileCloseCompletion.current
      const confirmation = setupConfirmation.current
      if (confirmation && !await confirmation) return false
      return (await confirmClose(useDoc.getState(), undefined, (id) => navigate(`/d/${id}`))) !== null
    } },
      () => nativeBridge.invoke<void>('finish_close').catch((error) => { setError(String(error)); throw error }),
      (locked) => {
        closingWindow.current = locked
        document.getElementById('root')!.inert = locked || fileCloseCompletion.current !== null
      },
      async () => {
        try { await nativeBridge.invoke('cancel_close') }
        catch (error) { setError(String(error)) }
      })
    let unlisten: (() => void) | undefined
    void nativeBridge.listen('close-requested', () => { void close() }).then((stop) => {
      if (disposed) stop()
      else { unlisten = stop; return nativeBridge.invoke<void>('close_ready') }
    }).catch((error) => setError(String(error)))
    let unlistenCloseFiles: (() => void) | undefined
    void nativeBridge.listen('close-files-requested', (payload) => {
      const request = payload as CloseFilesRequest
      void answerCloseRequest.current(request)
        .catch(() => unavailable(request.ids))
        .then((results) => nativeBridge.invoke<boolean>('complete_close_request', { requestId: request.request, results }))
        .catch((error) => setError(String(error)))
    }).then((stop) => {
      if (disposed) stop()
      else { unlistenCloseFiles = stop; return nativeBridge.invoke<void>('close_requests_ready') }
    }).catch((error) => setError(String(error)))
    return () => {
      disposed = true; clearInterval(timer); unlisten?.(); unlistenCloseFiles?.()
      window.removeEventListener('focus', revalidate)
    }
  }, [])
  const chooseFiles = (): void => {
    void nativeBridge.invoke<void>('choose_files').catch((error) => setError(String(error)))
  }
  const dismissOpeningErrors = (): void => {
    void nativeBridge.invoke<void>('dismiss_opening_errors').catch((error) => setError(String(error)))
  }
  /** Releases a file through the store and the native registry; false when edits arrived meanwhile. */
  const releaseFile = async (fileId: string, discardRevision?: number): Promise<boolean> => {
    let snapshot: OpeningSnapshot | undefined
    const closed = await useDoc.getState().closeDocument(fileId, async () => {
      snapshot = await nativeBridge.invoke<OpeningSnapshot>('close_document', {
        id: Number(fileId), activeId: activeRoute.current === null ? null : Number(activeRoute.current),
        activationRevision: activationRevision.current,
      })
      if (snapshot.files.length === 0 && setupComplete.current) await homeMotion.current?.leave(false)
    }, discardRevision)
    if (!closed) return false
    releaseDrafts(fileId)
    useTranslation.getState().release(fileId)
    activationRevision.current = snapshot!.activation_revision
    setFiles(snapshot!.files)
    navigate(snapshot!.active_id === null ? '/' : `/d/${snapshot!.active_id}`)
    return true
  }
  const closeFile = (file: OpenDocument): Promise<boolean> => {
    if (fileCloseCompletion.current) return Promise.resolve(false)
    const root = document.getElementById('root')!
    root.inert = true
    const completion = (async () => {
      try {
        const allowed = await confirmClose(useDoc.getState(), [file.id], (id) => navigate(`/d/${id}`))
        if (!allowed) return false
        if (!await releaseFile(file.id, allowed.get(file.id))) {
          setError(t('closeChangedAgain'))
          navigate(`/d/${file.id}`)
          return false
        }
        setError('')
        return true
      } catch (error) { setError(String(error)); return false }
      finally { fileCloseCompletion.current = null; root.inert = closingWindow.current }
    })()
    fileCloseCompletion.current = completion.then(() => {})
    return completion
  }
  // Agent closes never prompt and never lock the editor; they wait for any close already running.
  useLayoutEffect(() => {
    answerCloseRequest.current = async ({ ids }) => {
      while (fileCloseCompletion.current) await fileCloseCompletion.current
      if (closingWindow.current) return unavailable(ids)
      const completion = (async () => {
        try {
          const inventory = await nativeBridge.invoke<OpeningSnapshot>('snapshot')
          return await closeRequestedFiles(useDoc.getState(), ids, new Set(inventory.files.map((file) => file.id)),
            (fileId) => releaseFile(fileId))
        } finally {
          fileCloseCompletion.current = null
          // A window close that began meanwhile left the root inert for this completion.
          document.getElementById('root')!.inert = closingWindow.current
        }
      })()
      fileCloseCompletion.current = completion.then(() => {}, () => {})
      return completion
    }
  })
  const openLabel = t('openMarkdownFiles')
  return <Notifications>
    <div className={`native-documents${navigator.platform.startsWith('Mac') ? ' native-titlebar-overlay' : ''}`} data-tauri-drag-region>
      <button type="button" className={`native-open${atHome ? ' native-open-home' : ' btn-icon'}`} onClick={chooseFiles}
        aria-label={openLabel} title={openLabel}><FileIcon />
        {atHome && <><span className="native-open-label">{openLabel}</span>
          <span className="native-open-shortcut" aria-hidden="true">{navigator.platform.startsWith('Mac') ? '⌘O' : 'Ctrl+O'}</span></>}</button>
      <FileTabs files={files} activeId={id} language={language} needsAttention={documentState.needsAttention}
        onSelect={(fileId) => navigate(`/d/${fileId}`)}
        onAttention={(fileId) => { if (id === fileId) void documentState.openConflict() }} onClose={closeFile} />
      <div className="native-document-controls" ref={setToolbarTarget} />
    </div>
      {openingErrors.length > 0 && <Notification error onDismiss={dismissOpeningErrors}>
        <ul>{openingErrors.map((message, index) => <li key={index}>{message}</li>)}</ul>
      </Notification>}
      {error && <Notice key={error} error>{error}</Notice>}
      {setupError && <Notice key={setupError} error>{setupError}
        <button type="button" onClick={() => { void refreshSetup.current() }}>
          {t('retryLoadingSetup')}
        </button>
      </Notice>}
    <CloseDialog />
    <ToolbarTarget.Provider value={toolbarTarget}><App onboarding={setupRequired === false ? undefined : setup
      ? <NativeSetup snapshot={setup} onLanguagePreview={setPreviewLanguage}
        onConfirmationStarted={(completion) => {
          setupConfirmation.current = completion
          void completion.then(() => {
            if (setupConfirmation.current === completion) setupConfirmation.current = null
          })
        }} onConfirmed={(confirmed) => {
        setSetup(confirmed)
        setSetupRequired(false)
      }} /> : <div className="center-note" role="status">
        {t('loadingSetup')}
      </div>} /></ToolbarTarget.Provider>
    {setupRequired === false && route.kind === 'home' && <div className="native-home">
      <pre className="native-wordmark" aria-label="mastermind" role="img"><span className="native-wordmark-row">{'█▀▄▀█ ▄▀█ █▀ ▀█▀ █▀▀ █▀█ █▀▄▀█ █ █▄░█ █▀▄'}</span>{'\n'}<span className="native-wordmark-row">{'█░▀░█ █▀█ ▄█ ░█░ ██▄ █▀▄ █░▀░█ █ █░▀█ █▄▀'}</span></pre>
    </div>}
  </Notifications>
}
