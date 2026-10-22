import { storedConfig } from '../settings/config-values'
import type { ClientConfig } from '../settings/types'
import type { ThemeInfo } from '../../themes/types'
import { failureKind, HostError, type ReviewerHost } from '../app/host'

export interface NativeBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen(event: string, handler: () => void): Promise<() => void>
}

export function createNativeHost(bridge: NativeBridge, themes: ThemeInfo[]): ReviewerHost {
  const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    try { return await bridge.invoke<T>(command, args) }
    catch (error) {
      // Structured file errors carry their failure kind; preference commands reject with plain strings.
      if (error && typeof error === 'object' && 'error' in error) {
        const message = 'message' in error ? error.message : error.error
        throw new HostError(failureKind(error), String(message), error)
      }
      throw error
    }
  }
  const config = async (): Promise<ClientConfig> => {
    return storedConfig(await invoke<unknown>('read_preferences'))
  }
  const pendingReads = new Map<string, number>()
  const getFile: ReviewerHost['getFile'] = async (id) => {
    pendingReads.set(id, (pendingReads.get(id) ?? 0) + 1)
    try { return await invoke('read_document', { id }) }
    finally {
      const remaining = pendingReads.get(id)! - 1
      if (remaining) pendingReads.set(id, remaining)
      else pendingReads.delete(id)
    }
  }
  let preferenceWrite: Promise<unknown> = Promise.resolve()
  return {
    setAppearance: (color, appearance) => invoke<void>('set_appearance', { color, appearance }),
    getSession: (id) => invoke('document_meta', { id }),
    getFile,
    putFile: (id, content, baseVersion) => invoke('write_document', { id, content, baseVersion }),
    saveCopy: (id, content, forClose = false) => invoke('save_document_copy', { id, content, forClose }),
    translations: (id) => invoke('list_translations', { id }),
    config,
    updateConfig(patch) {
      const write = preferenceWrite.catch(() => {}).then(async () => {
        await invoke('write_preferences', { patch })
        return config()
      })
      preferenceWrite = write
      return write
    },
    themes: async () => themes,
    subscribe(id, listener) {
      let closed = false
      let unlisten: (() => void) | undefined
      let revalidation: ReturnType<typeof setInterval> | undefined
      const invalidate = (): void => {
        if (closed) return
        listener('changed')
        void invoke('watch_document', { id }).catch(() => {})
      }
      const poll = (): void => { if (!pendingReads.has(id)) invalidate() }
      // Subscribe before watching, then revalidate to cover changes during registration.
      void bridge.listen('document-invalidated', invalidate).then(async (stop) => {
        if (closed) { stop(); return }
        unlisten = stop
        await invoke('watch_document', { id })
        if (closed) return
        revalidation = setInterval(poll, 5000)
        invalidate()
      }).catch(() => {
        if (closed) return
        revalidation = setInterval(poll, 1000)
        invalidate()
      })
      return () => { closed = true; unlisten?.(); clearInterval(revalidation) }
    },
  }
}
