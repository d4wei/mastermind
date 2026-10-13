import { useEffect, useState } from 'react'
import { App } from '../app/App'
import { navigate } from '../app/route'
import { useDoc } from '../app/store'
import { useConfig } from '../app/configStore'
import { nativeBridge } from './bridge'
import { createCloseHandler } from './close'

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
  const id = useDoc((s) => s.sessionId)
  const chinese = useConfig((s) => s.config?.uiLang === 'zh-CN')
  useEffect(() => {
    let disposed = false
    let activationRevision = 0
    let refreshing = false
    const refresh = async (): Promise<void> => {
      if (refreshing) return
      refreshing = true
      try {
        const snapshot = await nativeBridge.invoke<OpeningSnapshot>('snapshot')
        if (disposed) return
        setFiles(snapshot.files)
        setOpeningErrors(snapshot.opening_errors)
        if (snapshot.activation_revision > activationRevision) {
          activationRevision = snapshot.activation_revision
          if (snapshot.active_id !== null) navigate(`/d/${snapshot.active_id}`)
        }
      } catch (error) { if (!disposed) setError(String(error)) }
      finally { refreshing = false }
    }
    const revalidate = (): void => { useDoc.getState().notifyDiskChange(0) }
    window.addEventListener('focus', revalidate)
    void refresh()
    const timer = setInterval(() => { void refresh() }, 500)
    const close = createCloseHandler({ prepareToClose: () => useDoc.getState().prepareToClose() },
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
    </div>
    <App native home={<div className="center-note"><h1>mastermind</h1>
      <p>{chinese ? '打开文件以开始审阅' : 'Open a file to start reviewing'}</p>
      <button type="button" onClick={chooseFiles}>{openLabel}</button></div>} />
  </>
}
