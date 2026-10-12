import { useEffect, useState } from 'react'
import { App } from '../app/App'
import { navigate } from '../app/route'
import { useDoc } from '../app/store'
import { useConfig } from '../app/configStore'
import { nativeBridge } from './bridge'
import { createCloseHandler } from './close'

export function NativeReviewer() {
  const [files, setFiles] = useState<string[]>([])
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  const id = useDoc((s) => s.sessionId)
  const chinese = useConfig((s) => s.config?.uiLang === 'zh-CN')
  useEffect(() => {
    let disposed = false
    let seen = 0
    const refresh = async (): Promise<void> => {
      try {
        const snapshot = await nativeBridge.invoke<{ files: string[] }>('snapshot')
        if (disposed) return
        setFiles(snapshot.files)
        if (snapshot.files.length > seen) navigate(`/d/${snapshot.files.length - 1}`)
        seen = snapshot.files.length
      } catch (error) { if (!disposed) setError(String(error)) }
    }
    const revalidate = (): void => { useDoc.getState().notifyDiskChange(0) }
    window.addEventListener('focus', revalidate)
    void refresh()
    const timer = setInterval(() => { void refresh() }, 500)
    const close = createCloseHandler({ prepareToClose: () => useDoc.getState().prepareToClose() },
      () => nativeBridge.invoke('finish_close'),
      (locked) => { document.getElementById('root')!.inert = locked },
      () => { setBlocked(true) })
    let unlisten: (() => void) | undefined
    void nativeBridge.listen('close-requested', () => { void close() }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    }).catch((error) => setError(String(error)))
    return () => { disposed = true; clearInterval(timer); unlisten?.(); window.removeEventListener('focus', revalidate) }
  }, [])
  return <>
    <div className="native-documents">
      <select aria-label={chinese ? '打开的文件' : 'Open files'} value={id ?? ''}
        onChange={(event) => navigate(`/d/${event.target.value}`)}>
        <option value="" disabled>{chinese ? '打开文件以开始审阅' : 'Open a file to start reviewing'}</option>
        {files.map((file, index) => <option key={file} value={index}>{file}</option>)}
      </select>
      {blocked && useDoc.getState().hasPendingWrites() && <span role="alert">{chinese ? '尚有未保存的更改。请检查打开的文件后重试。' :
        'Changes remain unsaved. Check the open files before quitting again.'}</span>}
      {error && <span role="alert">{error}</span>}
    </div>
    <App native home={<div className="center-note"><h1>mastermind</h1>
      <p>{chinese ? '打开文件以开始审阅' : 'Open a file to start reviewing'}</p></div>} />
  </>
}
