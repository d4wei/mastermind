import { useTranslation } from '../translate/translationStore'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { App } from '../app/App'
import { navigate, useRoute } from '../app/route'
import { useDoc } from '../documents/store'
import { useConfig } from '../app/configStore'
import { requestFind } from '../find/events'
import { FileIcon } from '../icons'
import { FileTabs, type OpenDocument } from './FileTabs'
import { ToolbarTarget } from '../app/ToolbarTarget'
import { nativeBridge } from './bridge'
import { createCloseHandler } from './close'
import { confirmClose } from './confirm-close'
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

export function NativeReviewer() {
  const [files, setFiles] = useState<OpenDocument[]>([])
  const closingFile = useRef(false)
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
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
  const homeMotion = useRef<ReturnType<typeof createHomeMotion> | null>(null)
  const atHome = files.length === 0 && setupRequired === false
  const homeReady = useRef(false)
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
  const configuredChinese = useConfig((s) => s.config?.uiLang === 'zh-CN')
  const chinese = setupRequired !== false && previewLanguage ? previewLanguage === 'zh-CN' : configuredChinese
  useEffect(() => {
    let disposed = false
    let setupRevision = -1
    let refreshing = false
    const refresh = async (): Promise<void> => {
      if (refreshing || closingFile.current || closingWindow.current) return
      refreshing = true
      try {
        const [opening, onboarding] = await Promise.allSettled([
          nativeBridge.invoke<OpeningSnapshot>('snapshot'),
          nativeBridge.invoke<SetupSnapshot>('setup_snapshot', {
            uiLangDefault: systemInterfaceLanguage(navigator.languages),
          }),
        ])
        if (disposed || closingFile.current || closingWindow.current) return
        if (opening.status === 'fulfilled' && opening.value.activation_revision >= activationRevision.current) {
          const snapshot = opening.value
          if (snapshot.files.length > 0 && homeReady.current) {
            await homeMotion.current?.leave(true)
            if (disposed) return
          }
          for (const file of snapshot.files) if (file.language) useTranslation.getState().hint(file.id, file.language)
          setFiles(snapshot.files)
          setOpeningErrors(snapshot.opening_errors)
          if (snapshot.activation_revision > activationRevision.current) {
            activationRevision.current = snapshot.activation_revision
            if (snapshot.active_id !== null) navigate(`/d/${snapshot.active_id}`)
          }
        } else if (opening.status === 'rejected') setError(String(opening.reason))
        if (onboarding.status === 'fulfilled') {
          setSetupError('')
          if (onboarding.value.revision >= setupRevision) {
            setupRevision = onboarding.value.revision
            setSetup(onboarding.value)
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
        document.getElementById('root')!.inert = locked || closingFile.current
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
    return () => { disposed = true; clearInterval(timer); unlisten?.(); window.removeEventListener('focus', revalidate) }
  }, [])
  const chooseFiles = (): void => {
    void nativeBridge.invoke<void>('choose_files').catch((error) => setError(String(error)))
  }
  const dismissOpeningErrors = (): void => {
    void nativeBridge.invoke<void>('dismiss_opening_errors').catch((error) => setError(String(error)))
  }
  const closeFile = (file: OpenDocument): Promise<boolean> => {
    if (closingFile.current) return Promise.resolve(false)
    closingFile.current = true
    const root = document.getElementById('root')!
    root.inert = true
    const completion = (async () => {
      try {
        let snapshot: OpeningSnapshot | undefined
        const allowed = await confirmClose(useDoc.getState(), [file.id], (id) => navigate(`/d/${id}`))
        if (!allowed) return false
        const closed = await useDoc.getState().closeDocument(file.id, async () => {
          snapshot = await nativeBridge.invoke<OpeningSnapshot>('close_document', {
            id: Number(file.id), activeId: id === null ? null : Number(id),
            activationRevision: activationRevision.current,
          })
          if (snapshot.files.length === 0) await homeMotion.current?.leave(false)
        }, allowed.get(file.id))
        if (!closed) {
          setError(chinese ? '文件状态再次变化，请重试关闭。' : 'The file changed again. Please try closing it again.')
          navigate(`/d/${file.id}`)
          return false
        }
        releaseDrafts(file.id)
        useTranslation.getState().release(file.id)
        activationRevision.current = snapshot!.activation_revision
        setFiles(snapshot!.files)
        setError('')
        navigate(snapshot!.active_id === null ? '/' : `/d/${snapshot!.active_id}`)
        return true
      } catch (error) { setError(String(error)); return false }
      finally { closingFile.current = false; root.inert = closingWindow.current; fileCloseCompletion.current = null }
    })()
    fileCloseCompletion.current = completion.then(() => {})
    return completion
  }
  const openLabel = chinese ? '打开 Markdown 文件…' : 'Open Markdown files…'
  return <Notifications>
    <div className={`native-documents${navigator.platform.startsWith('Mac') ? ' native-titlebar-overlay' : ''}`} data-tauri-drag-region>
      <button type="button" className={`native-open${atHome ? ' native-open-home' : ' btn-icon'}`} onClick={chooseFiles}
        aria-label={openLabel} title={openLabel}><FileIcon />
        {atHome && <><span className="native-open-label">{openLabel}</span>
          <span className="native-open-shortcut" aria-hidden="true">{navigator.platform.startsWith('Mac') ? '⌘O' : 'Ctrl+O'}</span></>}</button>
      <FileTabs files={files} activeId={id} chinese={chinese} needsAttention={documentState.needsAttention}
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
          {chinese ? '重试加载设置' : 'Retry loading setup'}
        </button>
      </Notice>}
    <CloseDialog />
    <ToolbarTarget.Provider value={toolbarTarget}><App native onboarding={setupRequired === false ? undefined : setup
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
        {chinese ? '正在加载设置…' : 'Loading setup…'}
      </div>} home={<div className="native-home">
      <pre className="native-wordmark" aria-label="mastermind" role="img"><span className="native-wordmark-row">{'█▀▄▀█ ▄▀█ █▀ ▀█▀ █▀▀ █▀█ █▀▄▀█ █ █▄░█ █▀▄'}</span>{'\n'}<span className="native-wordmark-row">{'█░▀░█ █▀█ ▄█ ░█░ ██▄ █▀▄ █░▀░█ █ █░▀█ █▄▀'}</span></pre>
    </div>} /></ToolbarTarget.Provider>
  </Notifications>
}
