import { useEffect, useRef, useState } from 'react'
import { App } from '../app/App'
import { navigate } from '../app/route'
import { useDoc } from '../documents/store'
import { useConfig } from '../app/configStore'
import { FileIcon, CrossIcon, AlertIcon } from '../icons'
import { fileLabels } from './file-labels'
import { nativeBridge } from './bridge'
import { createCloseHandler } from './close'
import { NativeSetup, systemInterfaceLanguage, type SetupSnapshot } from './NativeSetup'

interface OpenDocument { id: string; path: string }

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
  const [blocked, setBlocked] = useState(false)
  const [setup, setSetup] = useState<SetupSnapshot | null>(null)
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [setupError, setSetupError] = useState('')
  const [previewLanguage, setPreviewLanguage] = useState<SetupSnapshot['values']['uiLang']>()
  const refreshSetup = useRef<() => Promise<void>>(async () => {})
  const setupConfirmation = useRef<Promise<boolean> | null>(null)
  const documentState = useDoc()
  const id = documentState.sessionId
  const pills = useRef<HTMLElement>(null)
  const focusAfterClose = useRef<string | null | undefined>(undefined)
  const activePath = id === null ? undefined : files.find((file) => file.id === id)?.path
  useEffect(() => {
    pills.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activePath])
  useEffect(() => {
    if (focusAfterClose.current === undefined || focusAfterClose.current !== id) return
    const target = pills.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')
      ?? document.querySelector<HTMLButtonElement>('.native-open')
    target?.focus()
    focusAfterClose.current = undefined
  }, [id, files])
  useEffect(() => {
    void nativeBridge.invoke<void>('set_window_title', {
      value: activePath ? `mastermind - ${activePath}` : 'mastermind',
    }).catch((error) => setError(String(error)))
  }, [activePath])
  const labels = fileLabels(files.map((file) => file.path))
  const configuredChinese = useConfig((s) => s.config?.uiLang === 'zh-CN')
  const chinese = setupRequired !== false && previewLanguage ? previewLanguage === 'zh-CN' : configuredChinese
  useEffect(() => {
    let disposed = false
    let setupRevision = -1
    let refreshing = false
    const refresh = async (): Promise<void> => {
      if (refreshing || closingFile.current) return
      refreshing = true
      try {
        const [opening, onboarding] = await Promise.allSettled([
          nativeBridge.invoke<OpeningSnapshot>('snapshot'),
          nativeBridge.invoke<SetupSnapshot>('setup_snapshot', {
            uiLangDefault: systemInterfaceLanguage(navigator.languages),
          }),
        ])
        if (disposed || closingFile.current) return
        if (opening.status === 'fulfilled' && opening.value.activation_revision >= activationRevision.current) {
          const snapshot = opening.value
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
    const revalidate = (): void => { useDoc.getState().notifyDiskChange(0) }
    window.addEventListener('focus', revalidate)
    void refresh()
    const timer = setInterval(() => { void refresh() }, 500)
    const close = createCloseHandler({ prepareToClose: async () => {
      await fileCloseCompletion.current
      const confirmation = setupConfirmation.current
      if (confirmation && !await confirmation) return false
      return useDoc.getState().prepareToClose()
    } },
      () => nativeBridge.invoke('finish_close'),
      (locked) => {
        closingWindow.current = locked
        document.getElementById('root')!.inert = locked || closingFile.current
      },
      async () => {
        setBlocked(true)
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
  const closeFile = (file: OpenDocument): void => {
    if (closingFile.current) return
    closingFile.current = true
    const root = document.getElementById('root')!
    root.inert = true
    fileCloseCompletion.current = (async () => {
      try {
        let snapshot: OpeningSnapshot | undefined
        const closed = await useDoc.getState().closeDocument(file.id, async () => {
          snapshot = await nativeBridge.invoke<OpeningSnapshot>('close_document', {
            id: Number(file.id), activeId: id === null ? null : Number(id),
            activationRevision: activationRevision.current,
          })
        })
        if (!closed) {
          setError(chinese ? '文件尚有未保存的更改，请处理后再关闭。' :
            'This file has unsaved changes. Resolve them before closing it.')
          navigate(`/d/${file.id}`)
          return
        }
        focusAfterClose.current = snapshot!.active_id === null ? null : String(snapshot!.active_id)
        activationRevision.current = snapshot!.activation_revision
        setFiles(snapshot!.files)
        setError('')
        navigate(snapshot!.active_id === null ? '/' : `/d/${snapshot!.active_id}`)

      } catch (error) { setError(String(error)) }
      finally { closingFile.current = false; root.inert = closingWindow.current; fileCloseCompletion.current = null }
    })()
  }
  const openLabel = chinese ? '打开文件…' : 'Open files…'
  return <>
    <div className={`native-documents${navigator.platform.startsWith('Mac') ? ' native-titlebar-overlay' : ''}`} data-tauri-drag-region>
      <button type="button" className="native-open" onClick={chooseFiles}
        aria-label={openLabel} title={openLabel}><FileIcon /></button>
      <nav ref={pills} data-tauri-drag-region className="native-file-pills" aria-label={chinese ? '打开的文件' : 'Open files'}>
        {files.map((file, index) => <div key={file.id}
          className={`native-file-pill${id === file.id ? ' active' : ''}`}>
          <button type="button" className="native-file-select"
            aria-current={id === file.id ? 'page' : undefined}
            title={file.path} onClick={() => navigate(`/d/${file.id}`)}>{labels[index]}</button>
          {documentState.needsAttention(file.id) && <button type="button" className="native-file-attention btn-ghost"
            aria-label={`${labels[index]} · ${chinese ? '需要处理' : 'Needs attention'}`}
            onClick={() => { navigate(`/d/${file.id}`); if (id === file.id) void documentState.openConflict() }}><AlertIcon /></button>}
          <button type="button" className="native-file-close" onClick={() => closeFile(file)}
            aria-label={`${chinese ? '关闭' : 'Close'} ${labels[index]}`}
            title={`${chinese ? '关闭' : 'Close'} ${file.path}`}><CrossIcon /></button>
        </div>)}
      </nav>
      {blocked && useDoc.getState().hasPendingWrites() && <span role="alert">{chinese ? '尚有未保存的更改。请检查打开的文件后重试。' :
        'Changes remain unsaved. Check the open files before quitting again.'}</span>}
      {openingErrors.length > 0 && <div className="native-opening-errors" role="alert">
        <ul>{openingErrors.map((message, index) => <li key={index}>{message}</li>)}</ul>
        <button type="button" onClick={dismissOpeningErrors}>
          {chinese ? '关闭打开错误提示' : 'Dismiss opening errors'}
        </button>
      </div>}
      {error && <span role="alert">{error}</span>}
      {setupError && <span role="alert">{setupError}
        <button type="button" onClick={() => { void refreshSetup.current() }}>
          {chinese ? '重试加载设置' : 'Retry loading setup'}
        </button>
      </span>}
    </div>
    <App native onboarding={setupRequired === false ? undefined : setup
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
      </div>} home={<div className="center-note"><h1>mastermind</h1>
      <p>{chinese ? '打开文件以开始审阅' : 'Open a file to start reviewing'}</p>
      <button type="button" onClick={chooseFiles}>{openLabel}</button></div>} />
  </>
}
