import { storedConfig } from '../settings/config-values'
import type { ClientConfig } from '../settings/types'
import type { ThemeInfo } from '../../themes/types'
import { failureKind, HostError, type FileResponse, type ReviewerHost } from '../app/host'

/** `read_document`'s reply when the caller's `knownVersion` is still the file's version. */
interface UnchangedRead { version: string; unchanged: true }

export interface NativeBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  /** `handler` receives the event's payload; events without one deliver null. */
  listen(event: string, handler: (payload?: unknown) => void): Promise<() => void>
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
  // The last version and text known for each subscribed document, so revalidation can ask the
  // host to confirm a version instead of sending the whole file again.
  const held = new Map<string, FileResponse>()
  const subscribers = new Map<string, number>()
  const hold = (id: string, file: FileResponse): void => {
    if (subscribers.has(id) && typeof file?.content === 'string') held.set(id, file)
  }
  const read = async (id: string): Promise<FileResponse> => {
    const known = held.get(id)
    const reply = await invoke<FileResponse | UnchangedRead>('read_document',
      known ? { id, knownVersion: known.version } : { id })
    if (!reply || typeof reply !== 'object' || !('unchanged' in reply)) { hold(id, reply); return reply }
    if (known?.version === reply.version) return known
    // Only a confirmation of the version this read sent can stand for its text.
    held.delete(id)
    return read(id)
  }
  const getFile: ReviewerHost['getFile'] = async (id) => {
    pendingReads.set(id, (pendingReads.get(id) ?? 0) + 1)
    try { return await read(id) }
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
    async putFile(id, content, baseVersion) {
      const written = await invoke<{ version: string; lossy?: boolean }>('write_document', { id, content, baseVersion })
      // The host verified that the written file holds exactly `content`.
      hold(id, { version: written.version, content, lossy: written.lossy })
      return written
    },
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
      subscribers.set(id, (subscribers.get(id) ?? 0) + 1)
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
      return () => {
        if (closed) return
        closed = true; unlisten?.(); clearInterval(revalidation)
        const remaining = subscribers.get(id)! - 1
        if (remaining) subscribers.set(id, remaining)
        else { subscribers.delete(id); held.delete(id) }
      }
    },
  }
}
