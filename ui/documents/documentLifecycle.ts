import { useDoc, type DocStore } from './store'

type DocumentStore = { getState(): Pick<DocStore, 'prepareToClose' | 'pendingDocuments'> }

export function registerDocumentLifecycle(store: DocumentStore = useDoc): () => void {
  const flush = (): void => { void store.getState().prepareToClose() }
  const onVisibility = (): void => { if (document.hidden) flush() }
  const beforeUnload = (event: BeforeUnloadEvent): void => {
    flush()
    // Browsers cannot await writes on unload; retained dirty buffers require a prompt.
    if (store.getState().pendingDocuments().length > 0) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  window.addEventListener('blur', flush)
  window.addEventListener('beforeunload', beforeUnload)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.removeEventListener('blur', flush)
    window.removeEventListener('beforeunload', beforeUnload)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
