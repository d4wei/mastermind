import { DEFAULT_CONFIG } from '../../shared/config'
import type { ClientConfig, ThemeInfo } from '../../shared/types'
import { ApiError } from '../app/api'
import type { ReviewerHost } from '../app/host'

export interface NativeBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen(event: string, handler: () => void): Promise<() => void>
}

export function createNativeHost(bridge: NativeBridge, themes: ThemeInfo[]): ReviewerHost {
  const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    try { return await bridge.invoke<T>(command, args) }
    catch (error) {
      if (error && typeof error === 'object' && 'status' in error && 'error' in error) {
        const message = 'message' in error ? error.message : error.error
        throw new ApiError(Number(error.status), String(message), error)
      }
      throw error
    }
  }
  const config = async (): Promise<ClientConfig> => {
    const saved = await invoke<Partial<ClientConfig> | null>('read_preferences')
    return { ...DEFAULT_CONFIG, ...saved, version: 1 }
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
    getSession: (id) => invoke('document_meta', { id }),
    getFile,
    putFile: (id, content, baseVersion) => invoke('write_document', { id, content, baseVersion }),
    rename: async () => { throw new ApiError(501, 'Native file renaming is not implemented') },
    translation: (id, targetLang) => invoke('read_translation', { id, targetLang }),
    config,
    updateConfig(patch) {
      const write = preferenceWrite.catch(() => {}).then(async () => {
        const next = { ...await config(), ...patch }
        await invoke('write_preferences', { config: next })
        return next
      })
      preferenceWrite = write
      return write
    },
    themes: async () => themes,
    browsers: async () => [],
    events(id) {
      const listeners = new Map<string, Set<(event: MessageEvent) => void>>()
      let closed = false
      let unlisten: (() => void) | undefined
      let revalidation: ReturnType<typeof setInterval> | undefined
      const invalidate = (): void => {
        if (closed) return
        const event = new MessageEvent('file-changed', { data: JSON.stringify({ mtimeMs: 0 }) })
        listeners.get('file-changed')?.forEach((listener) => listener(event))
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
      return {
        addEventListener(name, listener) {
          if (!listeners.has(name)) listeners.set(name, new Set())
          listeners.get(name)!.add(listener)
        },
        close() { closed = true; unlisten?.(); clearInterval(revalidation); listeners.clear() },
      }
    },
  }
}
