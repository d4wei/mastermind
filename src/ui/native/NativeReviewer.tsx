import { useEffect, useRef, useState } from 'react'
import { App } from '../app/App'
import { navigate } from '../app/route'
import { useDoc } from '../app/store'
import { useConfig } from '../app/configStore'
import { nativeBridge } from './bridge'
import { createCloseHandler } from './close'
import { NativeSetup, systemInterfaceLanguage, type SetupSnapshot } from './NativeSetup'

interface OpeningSnapshot {
  files: string[]
  activation_revision: number
  active_id: number | null
  opening_errors: string[]
}

export function NativeReviewer() {
  const [files, setFiles] = useState<string[]>([])
  const [openingErrors, setOpeningErrors] = useState<string[]>([])
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  const [setup, setSetup] = useState<SetupSnapshot | null>(null)
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [setupError, setSetupError] = useState('')
  const [previewLanguage, setPreviewLanguage] = useState<SetupSnapshot['values']['uiLang']>()
  const refreshSetup = useRef<() => Promise<void>>(async () => {})
  const setupConfirmation = useRef<Promise<boolean> | null>(null)
  const id = useDoc((s) => s.sessionId)
  const configuredChinese = useConfig((s) => s.config?.uiLang === 'zh-CN')
  const chinese = setupRequired !== false && previewLanguage ? previewLanguage === 'zh-CN' : configuredChinese
  useEffect(() => {
    let disposed = false
    let activationRevision = 0
    let setupRevision = -1
    let refreshing = false
    const refresh = async (): Promise<void> => {
      if (refreshing) return
      refreshing = true
      try {
        const [opening, onboarding] = await Promise.allSettled([
          nativeBridge.invoke<OpeningSnapshot>('snapshot'),
          nativeBridge.invoke<SetupSnapshot>('setup_snapshot', {
            uiLangDefault: systemInterfaceLanguage(navigator.languages),
          }),
        ])
        if (disposed) return
        if (opening.status === 'fulfilled') {
          const snapshot = opening.value
          setFiles(snapshot.files)
          setOpeningErrors(snapshot.opening_errors)
          if (snapshot.activation_revision > activationRevision) {
            activationRevision = snapshot.activation_revision
            if (snapshot.active_id !== null) navigate(`/d/${snapshot.active_id}`)
          }
        } else setError(String(opening.reason))
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
      const confirmation = setupConfirmation.current
      if (confirmation && !await confirmation) return false
      return useDoc.getState().prepareToClose()
    } },
      () => nativeBridge.invoke('finish_close'),
      (locked) => { document.getElementById('root')!.inert = locked },
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
  const openLabel = chinese ? '打开文件…' : 'Open files…'
  return <>
    <div className="native-documents">
      <button type="button" onClick={chooseFiles}>{openLabel}</button>
      <select aria-label={chinese ? '打开的文件' : 'Open files'} value={id ?? ''}
        onChange={(event) => navigate(`/d/${event.target.value}`)}>
        <option value="" disabled>{chinese ? '打开文件以开始审阅' : 'Open a file to start reviewing'}</option>
        {files.map((file, index) => <option key={file} value={index}>{file}</option>)}
      </select>
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
