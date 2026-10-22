import { APP_NAME } from '../app/constants'
import { create } from 'zustand'
import { applyTextEdits } from '../../document/edits'
import { detectEol, normalizeToLf, restoreEol, type Eol } from '../../document/eol'
import type { TextEdit } from '../../document/types'
import type { FileResponse, SessionMeta } from '../app/hostTypes'
import { HostError, requireReviewerHost } from '../app/host'

export type ViewMode = 'reading' | 'source'

const AUTOSAVE_MS = 600

function setTabTitle(name: string): void {
  const g = globalThis as { document?: { title: string } }
  if (g.document) g.document.title = name ? `${name} — ${APP_NAME}` : APP_NAME
}

export type RecoveryError = 'read' | 'save'

export interface DocStore {
  sessionId: string | null
  meta: SessionMeta | null
  /** LF-normalized source; disk writes restore the document's line endings. */
  source: string
  savedSource: string
  eol: Eol
  version: string
  revision: number
  conflictDismissed: boolean
  recoveryError: RecoveryError | null
  copyError: boolean
  mode: ViewMode
  status: 'loading' | 'ready' | 'error'
  error: string | null
  conflict: boolean
  saving: boolean
  /** External buffer changes invalidate editor instances; editor input retains their history. */
  externalVersion: number
  scroller: ((offset: number, index: number) => void) | null
  /** Undo for review operations applied outside the editor. */
  history: string[]
  /** `deleted` is set only on evidence that the path is missing. */
  diskChange: { deleted: boolean } | null

  prepareToClose(ids?: string[]): Promise<boolean>
  pendingDocuments(ids?: string[]): { id: string; name: string; revision: number; copyFailed: boolean }[]
  closeDocument(id: string, release: () => Promise<void>, discardRevision?: number): Promise<boolean>
  hasDocument(id: string): boolean
  load(sessionId: string): Promise<void>
  undo(): void
  notifyDiskChange(deleted?: boolean): void
  openConflict(): Promise<void>
  closeConflict(): void
  retryRecovery(): Promise<boolean>
  saveCopy(id?: string, forClose?: boolean): Promise<string | null>
  needsAttention(id: string): boolean
  useConflictDisk(): Promise<boolean>
  setSource(source: string): void
  /** Editor transaction path — updates the buffer without remounting the editor. */
  setSourceFromEditor(source: string): void
  registerScroller(fn: DocStore['scroller']): void
  applyEdits(edits: TextEdit[]): void
  setMode(mode: ViewMode): void
  queueAutosave(): void
}

const documentKeys = [
  'meta', 'source', 'savedSource', 'eol', 'version', 'revision', 'conflictDismissed', 'recoveryError', 'copyError',
  'mode', 'conflict', 'saving', 'history', 'diskChange',
] as const satisfies readonly (keyof DocStore)[]

type DocumentState = Pick<DocStore, typeof documentKeys[number]>

/** Published while no document is active, so commands cannot reach a departed record. */
const releasedDocument: Omit<DocumentState, 'mode'> = {
  meta: null, source: '', savedSource: '', eol: 'lf', version: '', revision: 0,
  conflictDismissed: false, recoveryError: null, copyError: false, conflict: false, saving: false,
  history: [], diskChange: null,
}

interface DocumentRecord extends DocumentState {
  /** Exact text last read from or written to disk; mixed line endings cannot be rebuilt from `savedSource`. */
  diskSource: string
  autosaveTimer?: ReturnType<typeof setTimeout>
  write?: Promise<boolean>
  recovery?: Promise<unknown>
  diskGeneration: number
  /** An invalidation received while saving; it is read once the operation settles. */
  pendingInvalidation?: { deleted: boolean }
}

function documentState(record: DocumentState): DocumentState {
  return Object.fromEntries(documentKeys.map((key) => [key, record[key]])) as DocumentState
}

export function createDocStore() {
  const documents = new Map<string, DocumentRecord>()
  let activeId: string | null = null
  let loadRequest = 0
  let loadingId: string | null = null
  const clearAutosave = (id: string): void => {
    const record = documents.get(id)
    if (!record) return
    clearTimeout(record.autosaveTimer)
    record.autosaveTimer = undefined
  }
  const updateDocument = (id: string, patch: Partial<DocumentState>, published: Partial<DocStore> = {}): void => {
    const doc = documents.get(id)
    if (!doc) return
    if (patch.source !== undefined && patch.source !== doc.source) patch.revision = doc.revision + 1
    // Leaving a conflict ends its dismissal and failed copy; a later conflict starts visible.
    if (patch.conflict === false && doc.conflict) Object.assign(patch, { conflictDismissed: false, copyError: false })
    Object.assign(doc, patch)
    store.setState(activeId === id ? { ...published, ...documentState(doc) } : published)
  }
  const schedule = (id: string): void => {
    clearAutosave(id)
    const record = documents.get(id)
    if (!record) return
    record.autosaveTimer = setTimeout(() => { record.autosaveTimer = undefined; void saveDocument(id) }, AUTOSAVE_MS)
  }
  const deferInvalidation = (doc: DocumentRecord, deleted: boolean): void => {
    doc.pendingInvalidation = { deleted: deleted || !!doc.pendingInvalidation?.deleted }
  }
  /** Ends a write or recovery operation and reads any invalidation deferred during it. */
  const settle = (id: string): Promise<void> => {
    updateDocument(id, { saving: false })
    const doc = documents.get(id)
    const pending = doc?.pendingInvalidation
    if (!doc || !pending) return Promise.resolve()
    doc.pendingInvalidation = undefined
    return readDiskChange(id, pending.deleted)
  }
  const writeDocument = async (id: string): Promise<boolean> => {
    clearAutosave(id)
    const doc = documents.get(id)
    if (!doc || doc.saving || doc.conflict) return false
    const { source, savedSource, eol, version } = doc
    if (source === savedSource) return true
    const content = restoreEol(source, eol)
    doc.diskGeneration++
    updateDocument(id, { saving: true })
    let succeeded = false
    try {
      const res = await requireReviewerHost().putFile(id, content, version)
      doc.diskSource = content
      updateDocument(id, { savedSource: source, version: res.version, conflict: false, recoveryError: null, diskChange: null })
      succeeded = true
      return true
    } catch (err) {
      updateDocument(id, err instanceof HostError && err.kind === 'conflict'
        ? { conflict: true, recoveryError: null }
        : { conflict: true, recoveryError: 'save' })
      // A rejected write may have partially reached disk; retry must read before writing.
      deferInvalidation(doc, false)
      return false
    } finally {
      doc.diskGeneration++
      if (succeeded && doc.source !== doc.savedSource && !doc.conflict) schedule(id)
      void settle(id)
    }
  }
  const saveDocument = (id: string): Promise<boolean> => {
    const record = documents.get(id)
    if (!record) return Promise.resolve(false)
    if (record.write) return record.write
    const write = writeDocument(id).finally(() => { if (record.write === write) record.write = undefined })
    record.write = write
    return write
  }
  const reconcileDisk = (id: string, file: FileResponse): void => {
    const doc = documents.get(id)
    if (!doc) return
    if (doc.version === file.version) {
      const recoveredRead = doc.recoveryError === 'read'
      updateDocument(id, { diskChange: null, ...(recoveredRead ? { conflict: false, recoveryError: null } : {}) })
      if (recoveredRead && doc.source !== doc.savedSource) schedule(id)
      return
    }
    if (doc.saving) {
      deferInvalidation(doc, false)
      return
    }
    if (doc.diskSource === file.content) {
      // Metadata can change without changing the base text; keep local edits against the fresh token.
      updateDocument(id, { version: file.version, conflict: false, recoveryError: null, diskChange: null })
      if (doc.source !== doc.savedSource) schedule(id)
      return
    }
    if (doc.source === doc.savedSource || restoreEol(doc.source, doc.eol) === file.content) {
      const normalized = normalizeToLf(file.content)
      doc.diskSource = file.content
      updateDocument(id, { source: normalized, savedSource: normalized,
        eol: detectEol(file.content), version: file.version,
        conflict: false, recoveryError: null, diskChange: null,
        // Review undo snapshots predate the external text; replaying one would overwrite it.
        history: normalized === doc.source ? doc.history : [] })
      if (activeId === id) store.setState((s) => ({ externalVersion: s.externalVersion + 1 }))
    } else {
      updateDocument(id, { conflict: true, diskChange: { deleted: false }, recoveryError: null })
    }
  }
  const retainReadFailure = (id: string, err: unknown): void => {
    const doc = documents.get(id)!
    // Only the host's missing result is evidence of deletion; other read failures may be transient.
    const missing = err instanceof HostError && err.kind === 'missing'
    updateDocument(id, { conflict: true,
      diskChange: { deleted: missing || !!doc.diskChange?.deleted }, recoveryError: 'read' })
  }
  const readDiskChange = async (id: string, deleted: boolean): Promise<void> => {
    const doc = documents.get(id)
    if (!doc) return
    if (doc.saving) { doc.diskGeneration++; deferInvalidation(doc, deleted); return }
    const request = ++doc.diskGeneration
    if (deleted) { updateDocument(id, { conflict: true, diskChange: { deleted: true } }); return }
    try {
      const file = await requireReviewerHost().getFile(id)
      if (doc.diskGeneration === request) reconcileDisk(id, file)
    } catch (err) {
      if (doc.diskGeneration === request) retainReadFailure(id, err)
    }
  }
  const recover = async (id: string): Promise<boolean> => {
    const doc = documents.get(id)
    if (!doc?.conflict || doc.saving) return false
    clearAutosave(id)
    const request = ++doc.diskGeneration
    const revision = doc.revision
    updateDocument(id, { saving: true, recoveryError: null })
    try {
      const file = await requireReviewerHost().getFile(id)
      // A newer invalidation is read when this operation settles and presents the newer version.
      if (doc.diskGeneration !== request || doc.revision !== revision) return false
      const incoming = normalizeToLf(file.content)
      doc.diskSource = file.content
      updateDocument(id, { source: incoming, savedSource: incoming, eol: detectEol(file.content),
        version: file.version, conflict: false, recoveryError: null, diskChange: null,
        // Adoption stays reversible so review undo can recover the discarded buffer.
        history: incoming === doc.source ? doc.history : [...doc.history.slice(-49), doc.source] })
      if (activeId === id) store.setState((s) => ({ externalVersion: s.externalVersion + 1 }))
      return true
    } catch (err) {
      retainReadFailure(id, err)
      return false
    } finally {
      doc.diskGeneration++
      await settle(id)
    }
  }
  const trackRecovery = <T,>(id: string, operation: () => Promise<T>): Promise<T> => {
    const doc = documents.get(id)!
    const promise = operation().finally(() => { if (doc.recovery === promise) doc.recovery = undefined })
    doc.recovery = promise
    return promise
  }
  const store = create<DocStore>((publish, get) => {
    const set = (patch: Partial<DocStore> | ((state: DocStore) => Partial<DocStore>)): void => {
      const next = typeof patch === 'function' ? patch(get()) : patch
      if (next.sessionId !== undefined) activeId = next.sessionId
      if (!activeId || !documents.has(activeId)) { publish(next); return }
      updateDocument(activeId, Object.fromEntries(documentKeys.filter((key) => key in next)
        .map((key) => [key, next[key]])) as Partial<DocumentState>, next)
    }
    return ({
      ...releasedDocument,
      sessionId: null,
      mode: 'reading',
      status: 'loading',
      error: null,
      externalVersion: 0,
      scroller: null,

      async prepareToClose(ids) {
        const scope = ids ?? [...documents.keys()]
        // In-flight operations finish first; the second pass saves edits made behind them.
        await Promise.all(scope.map((id) => Promise.all([saveDocument(id), documents.get(id)?.recovery])))
        await Promise.all(scope.map(saveDocument))
        return get().pendingDocuments(ids).length === 0
      },

      pendingDocuments(ids) {
        return [...documents.entries()].filter(([id, doc]) => (!ids || ids.includes(id)) &&
          (doc.saving || doc.source !== doc.savedSource)).map(([id, doc]) =>
          ({ id, name: doc.meta!.displayName, revision: doc.revision, copyFailed: doc.copyError }))
      },

      hasDocument(id) { return documents.has(id) },

      async closeDocument(id, release, discardRevision) {
        const doc = documents.get(id)
        if (doc) {
          await doc.write
          await doc.recovery
          if (discardRevision === undefined || doc.revision !== discardRevision) {
            await saveDocument(id)
            if (doc.saving || doc.source !== doc.savedSource) return false
          }
        }
        await release()
        clearAutosave(id)
        if (doc) doc.diskGeneration++
        documents.delete(id)
        // A load already in flight must not restore a closed document.
        if (loadingId === id) { loadRequest++; loadingId = null }
        if (activeId === id) {
          setTabTitle('')
          set({ ...releasedDocument, sessionId: null, scroller: null, status: 'loading' })
        } else publish({})
        return true
      },

      async load(sessionId) {
        loadingId = sessionId
        const request = ++loadRequest
        const retained = documents.get(sessionId)
        if (retained) {
          set((s) => ({ ...documentState(retained), sessionId, status: 'ready', error: null,
            scroller: null, externalVersion: s.externalVersion + 1 }))
          setTabTitle(retained.meta!.displayName)
          await readDiskChange(sessionId, false)
          return
        }
        // Release the departing record so commands cannot reach it while this load runs or after it fails.
        set({ ...releasedDocument, sessionId: null, status: 'loading', error: null, scroller: null })
        try {
          const [meta, file] = await Promise.all([requireReviewerHost().getSession(sessionId), requireReviewerHost().getFile(sessionId)])
          if (request !== loadRequest) return
          const normalized = normalizeToLf(file.content)
          const record: DocumentRecord = {
            ...releasedDocument, meta, source: normalized, savedSource: normalized, eol: detectEol(file.content),
            diskSource: file.content, version: file.version, mode: get().mode, diskGeneration: 0,
          }
          documents.set(sessionId, record)
          set((s) => ({
            ...documentState(record), sessionId, status: 'ready', error: null,
            scroller: null, externalVersion: s.externalVersion + 1,
          }))
          setTabTitle(meta.displayName)
        } catch (err) {
          if (request !== loadRequest) return
          const message = err instanceof HostError && err.kind === 'missing'
            ? '__session-not-found__' : err instanceof Error ? err.message : String(err)
          set({ status: 'error', error: message })
        }
      },

      setSource(source) {
        if (get().conflict) return
        set((s) => ({
          source,
          externalVersion: s.externalVersion + 1,
          history: [...s.history.slice(-49), s.source],
        }))
        get().queueAutosave()
      },

      undo() {
        if (get().conflict) return
        const prev = get().history.at(-1)
        if (prev === undefined) return
        set((s) => ({ source: prev, history: s.history.slice(0, -1), externalVersion: s.externalVersion + 1 }))
        get().queueAutosave()
      },

      setSourceFromEditor(source) {
        if (get().conflict || source === get().source) return
        set({ source })
        get().queueAutosave()
      },

      registerScroller(fn) {
        set({ scroller: fn })
      },

      applyEdits(edits) {
        if (get().conflict) return
        set((s) => ({
          source: applyTextEdits(s.source, edits),
          externalVersion: s.externalVersion + 1,
          history: [...s.history.slice(-49), s.source],
        }))
        get().queueAutosave()
      },

      setMode(mode) {
        if (mode !== get().mode) set({ mode })
      },

      queueAutosave() {
        const id = get().sessionId
        if (id && !get().conflict) schedule(id)
      },

      notifyDiskChange(deleted = false) {
        const id = get().sessionId
        if (id) void readDiskChange(id, deleted)
      },

      needsAttention(id) { return !!documents.get(id)?.conflict },

      async openConflict() {
        if (get().conflict) set({ conflictDismissed: false })
      },

      closeConflict() { set({ conflictDismissed: true }) },

      async useConflictDisk() {
        const id = get().sessionId
        return id ? trackRecovery(id, () => recover(id)) : false
      },

      async retryRecovery() {
        const id = get().sessionId
        const doc = id ? documents.get(id) : undefined
        if (!id || !doc || doc.saving) return false
        return trackRecovery(id, async () => {
          const request = ++doc.diskGeneration
          updateDocument(id, { saving: true })
          try {
            const file = await requireReviewerHost().getFile(id)
            if (doc.diskGeneration !== request) return false
            updateDocument(id, { saving: false })
            if (file.version === doc.version) {
              updateDocument(id, { conflict: false, recoveryError: null, diskChange: null })
            } else reconcileDisk(id, file)
            return !doc.conflict && await saveDocument(id)
          } catch (err) { retainReadFailure(id, err); return false }
          finally { await settle(id) }
        })
      },

      async saveCopy(requestedId, forClose = false) {
        const id = requestedId ?? get().sessionId
        const doc = id ? documents.get(id) : undefined
        const host = requireReviewerHost()
        if (!id || !doc || doc.saving || !host.saveCopy) return null
        clearAutosave(id)
        return trackRecovery(id, async () => {
          const navigation = loadRequest
          updateDocument(id, { saving: true, copyError: false })
          try {
            const copy = await host.saveCopy!(id, restoreEol(doc.source, doc.eol), forClose)
            if (!copy) return null
            if (forClose) return id
            const source = normalizeToLf(copy.file.content)
            documents.set(copy.meta.sessionId, { ...doc, meta: copy.meta, source, savedSource: source,
              eol: detectEol(copy.file.content), diskSource: copy.file.content, version: copy.file.version,
              conflict: false, conflictDismissed: false, recoveryError: null, copyError: false, saving: false,
              diskChange: null, history: [], diskGeneration: 0,
              pendingInvalidation: undefined, write: undefined, recovery: undefined, autosaveTimer: undefined })
            doc.diskGeneration++
            documents.delete(id)
            if (get().sessionId === id && loadRequest === navigation) await get().load(copy.meta.sessionId)
            else publish({})
            return copy.meta.sessionId
          } catch {
            updateDocument(id, { copyError: true })
            return null
          } finally {
            await settle(id)
          }
        })
      },

    })
  })
  return store
}

export const useDoc = createDocStore()
