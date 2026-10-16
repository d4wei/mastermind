import { mergeText } from '../../document/merge'
import { APP_NAME } from '../app/constants'
import { create } from 'zustand'
import { applyTextEdits } from '../../document/edits'
import { detectEol, normalizeToLf, restoreEol, type Eol } from '../../document/eol'
import type { TextEdit } from '../../document/types'
import type { SessionMeta } from '../app/hostTypes'
import { HostError, requireReviewerHost } from '../app/host'
import type { FileResponse } from '../app/hostTypes'

export type ViewMode = 'reading' | 'source'

const AUTOSAVE_MS = 600

function setTabTitle(name: string): void {
  const g = globalThis as { document?: { title: string } }
  if (g.document) g.document.title = name ? `${name} — ${APP_NAME}` : APP_NAME
}

export type RecoveryError = 'read' | 'save' | 'overlap' | 'limit' | 'copy' | 'changed'

export interface DocStore {
  sessionId: string | null
  meta: SessionMeta | null
  /** LF-normalized source; disk writes restore the document's line endings. */
  source: string
  savedSource: string
  eol: Eol
  mtimeMs: number
  version: string
  revision: number
  conflictDismissed: boolean
  recoveryError: RecoveryError | null
  mode: ViewMode
  status: 'loading' | 'ready' | 'error'
  error: string | null
  conflict: boolean
  saving: boolean
  savingKind: 'save' | null
  notice: { kind: 'error' | 'ok'; msg: string; count?: number } | null
  /** External buffer changes invalidate editor instances; editor input retains their history. */
  externalVersion: number
  flushEditor: (() => void) | null
  scroller: ((offset: number, index: number) => void) | null
  /** Undo for review operations applied outside the editor. */
  history: string[]
  diskChange: { mtimeMs: number; deleted: boolean; content?: string; version?: string } | null

  flushAll(): Promise<void>
  hasPendingWrites(): boolean
  prepareToClose(): Promise<boolean>
  closeDocument(id: string, release: () => Promise<void>): Promise<boolean>
  hasDocument(id: string): boolean
  load(sessionId: string): Promise<void>
  undo(): void
  notifyDiskChange(mtimeMs: number, deleted?: boolean): void

  dismissDiskChange(): void
  reloadFromDisk(): Promise<void>
  openConflict(): Promise<void>
  closeConflict(): void
  tryMerge(): Promise<boolean>
  saveCopy(): Promise<string | null>
  needsAttention(id: string): boolean
  useConflictDisk(): Promise<boolean>
  setNotice(notice: DocStore['notice']): void
  setSource(source: string): void
  /** Editor flush path — updates the buffer without remounting the editor. */
  setSourceFromEditor(source: string): void
  registerFlusher(fn: (() => void) | null): void
  registerScroller(fn: DocStore['scroller']): void
  applyEdits(edits: TextEdit[]): void
  setMode(mode: ViewMode): void
  queueAutosave(): void
  autosave(): Promise<boolean>
  adoptDiskContent(content: string, mtimeMs: number, version: string): void
}

const documentKeys = [
  'meta', 'source', 'savedSource', 'eol', 'mtimeMs', 'version', 'revision', 'conflictDismissed', 'recoveryError',
  'mode', 'conflict', 'saving', 'savingKind', 'notice', 'history', 'diskChange',
] as const satisfies readonly (keyof DocStore)[]

type DocumentState = Pick<DocStore, typeof documentKeys[number]>

interface DocumentRecord extends DocumentState {
  autosaveTimer?: ReturnType<typeof setTimeout>
  write?: Promise<boolean>
  diskGeneration: number
  pendingInvalidation?: { mtimeMs: number; deleted: boolean }
}

function documentState(record: DocumentState): DocumentState {
  return Object.fromEntries(documentKeys.map((key) => [key, record[key]])) as DocumentState
}

export function createDocStore() {
  const documents = new Map<string, DocumentRecord>()
  let activeId: string | null = null
  let loadRequest = 0
  let loadingId: string | null = null
  const clearAutosave = (id = activeId): void => {
    if (!id) return
    const record = documents.get(id)
    clearTimeout(record?.autosaveTimer)
    if (record) record.autosaveTimer = undefined
  }
  const updateDocument = (id: string, patch: Partial<DocumentState>): void => {
    const doc = documents.get(id)
    if (!doc) return
    if (patch.source !== undefined && patch.source !== doc.source) patch.revision = doc.revision + 1
    if (patch.conflict && !doc.conflict && activeId === id) store.getState().flushEditor?.()
    Object.assign(doc, patch)
    store.setState(activeId === id ? documentState(doc) : {})
  }
  const schedule = (id: string): void => {
    clearAutosave(id)
    const record = documents.get(id)
    if (!record) return
    record.autosaveTimer = setTimeout(() => { record.autosaveTimer = undefined; void saveDocument(id) }, AUTOSAVE_MS)
  }
  const writeDocument = async (id: string): Promise<boolean> => {
    clearAutosave(id)
    const doc = documents.get(id)
    if (!doc || doc.saving || doc.conflict) return false
    const { source, savedSource, eol, version } = doc
    if (source === savedSource) return true
    doc.diskGeneration++
    updateDocument(id, { saving: true, savingKind: 'save', notice: null })
    let succeeded = false
    try {
      const res = await requireReviewerHost().putFile(id, restoreEol(source, eol), version)
      updateDocument(id, { savedSource: source, mtimeMs: res.mtimeMs, version: res.version, conflict: false, diskChange: null })
      succeeded = true
      return true
    } catch (err) {
      updateDocument(id, err instanceof HostError && err.kind === 'conflict'
        ? { conflict: true }
        : { notice: { kind: 'error', msg: 'saveFailed' } })
      return false
    } finally {
      doc.diskGeneration++
      updateDocument(id, { saving: false, savingKind: null })
      const latest = documents.get(id)!
      if (succeeded && latest.source !== latest.savedSource && !latest.conflict) schedule(id)
      const pending = doc.pendingInvalidation
      doc.pendingInvalidation = undefined
      if (pending) void readDiskChange(id, pending.mtimeMs, pending.deleted)
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
      updateDocument(id, { diskChange: null })
      return
    }
    if (doc.saving) {
      doc.pendingInvalidation = { mtimeMs: file.mtimeMs, deleted: false }
      return
    }
    if (doc.source === doc.savedSource && !doc.conflict) {
      const normalized = normalizeToLf(file.content)
      updateDocument(id, { source: normalized, savedSource: normalized,
        eol: detectEol(file.content), mtimeMs: file.mtimeMs, version: file.version,
        conflict: false, diskChange: null })
      if (store.getState().sessionId === id) store.setState((s) => ({ externalVersion: s.externalVersion + 1 }))
    } else {
      updateDocument(id, { conflict: true, notice: null, diskChange: { mtimeMs: file.mtimeMs,
        deleted: false, content: file.content, version: file.version } })
    }
  }
  const retainReadFailure = (id: string): void => {
    const doc = documents.get(id)!
    // Read failures cannot distinguish a missing path from an unreadable one.
    updateDocument(id, { conflict: true, notice: null, diskChange: {
      ...doc.diskChange, mtimeMs: doc.diskChange?.mtimeMs ?? 0,
      deleted: doc.diskChange?.deleted ?? false, version: undefined,
    }, recoveryError: 'read' })
  }
  const readDiskChange = async (id: string, mtimeMs: number, deleted: boolean): Promise<void> => {
    const doc = documents.get(id)
    if (!doc) return
    if (doc.saving) { doc.diskGeneration++; doc.pendingInvalidation = { mtimeMs, deleted }; return }
    updateDocument(id, { diskChange: { ...doc.diskChange, mtimeMs,
      deleted: deleted || !!doc.diskChange?.deleted, version: undefined } })
    const request = ++doc.diskGeneration
    if (deleted) { updateDocument(id, { conflict: true, notice: null }); return }
    try {
      const file = await requireReviewerHost().getFile(id)
      if (doc.diskGeneration === request) reconcileDisk(id, file)
    } catch {
      if (doc.diskGeneration === request) retainReadFailure(id)
    }
  }
  const recover = async (id: string, action: 'incoming' | 'merge'): Promise<boolean> => {
    const doc = documents.get(id)
    if (!doc?.conflict || doc.saving) return false
    clearAutosave(id)
    const request = ++doc.diskGeneration
    const revision = doc.revision
    updateDocument(id, { saving: true, savingKind: 'save', recoveryError: null })
    let writing = false
    try {
      const file = await requireReviewerHost().getFile(id)
      if (doc.diskGeneration !== request || doc.revision !== revision) {
        updateDocument(id, { recoveryError: 'changed' })
        return false
      }
      const incoming = normalizeToLf(file.content)
      let content = incoming
      let saved = { version: file.version, mtimeMs: file.mtimeMs }
      if (action === 'merge') {
        const result = mergeText(doc.savedSource, doc.source, incoming)
        if (result.kind !== 'clean') {
          updateDocument(id, { recoveryError: result.kind === 'conflict' ? 'overlap' : 'limit' })
          return false
        }
        content = result.content
        writing = true
        saved = await requireReviewerHost().putFile(id, restoreEol(content, detectEol(file.content)), file.version)
      }
      updateDocument(id, { source: content, savedSource: content, eol: detectEol(file.content),
        ...saved, conflict: false, conflictDismissed: false, recoveryError: null, diskChange: null,
        history: content === doc.source ? doc.history : [...doc.history.slice(-49), doc.source] })
      if (activeId === id) store.setState((s) => ({ externalVersion: s.externalVersion + 1 }))
      return true
    } catch {
      updateDocument(id, { recoveryError: writing ? 'save' : 'read' })
      // A failed write may have reached disk partially; revalidate before the next attempt.
      if (writing) doc.pendingInvalidation = { mtimeMs: 0, deleted: false }
      return false
    } finally {
      doc.diskGeneration++
      updateDocument(id, { saving: false, savingKind: null })
      const pending = doc.pendingInvalidation
      doc.pendingInvalidation = undefined
      if (pending) await readDiskChange(id, pending.mtimeMs, pending.deleted)
    }
  }
  const store = create<DocStore>((publish, get) => {
    const set = (patch: Partial<DocStore> | ((state: DocStore) => Partial<DocStore>)): void => {
      const next = typeof patch === 'function' ? patch(get()) : patch
      if (next.sessionId !== undefined) activeId = next.sessionId
      const record = activeId ? documents.get(activeId) : undefined
      if (record) {
        const changes = Object.fromEntries(documentKeys.filter((key) => key in next).map((key) => [key, next[key]])) as Partial<DocumentState>
        if (changes.source !== undefined && changes.source !== record.source) changes.revision = record.revision + 1
        Object.assign(record, changes)
        publish({ ...next, ...documentState(record) })
      } else publish(next)
    }
    return ({
      sessionId: null,
      meta: null,
      source: '',
      savedSource: '',
      eol: 'lf',
      mtimeMs: 0,
      version: '',
      revision: 0,
      conflictDismissed: false, recoveryError: null,
      mode: 'reading',
      status: 'loading',
      error: null,
      conflict: false,
      saving: false,
      savingKind: null,
      notice: null,
      externalVersion: 0,
      flushEditor: null,
      scroller: null,
      history: [],
      diskChange: null,

      async flushAll() {
        get().flushEditor?.()
        await Promise.all([...documents.keys()].map((id) => saveDocument(id)))
      },

      async prepareToClose() {
        get().flushEditor?.()
        await Promise.all([...documents.values()].flatMap((record) => record.write ? [record.write] : []))
        await get().flushAll()
        return !get().hasPendingWrites()
      },

      hasDocument(id) { return documents.has(id) },

      async closeDocument(id, release) {
        if (activeId === id) get().flushEditor?.()
        const doc = documents.get(id)
        if (doc) {
          await doc.write
          await saveDocument(id)
          if (doc.saving || doc.source !== doc.savedSource || doc.conflict) return false
        }
        await release()
        clearAutosave(id)
        if (doc) doc.diskGeneration++
        documents.delete(id)
        // A load already in flight must not restore a closed document.
        if (loadingId === id) { loadRequest++; loadingId = null }
        if (activeId === id) {
          setTabTitle('')
          set({ sessionId: null, meta: null, source: '', savedSource: '', history: [],
            conflictDismissed: false, recoveryError: null, conflict: false, diskChange: null, notice: null,
            flushEditor: null, scroller: null, status: 'loading' })
        } else publish({})
        return true
      },

      hasPendingWrites() {
        return [...documents.values()].some((doc) => doc.saving || doc.source !== doc.savedSource || doc.conflict)
      },

      async load(sessionId) {
        get().flushEditor?.()
        loadingId = sessionId
        const request = ++loadRequest
        const retained = documents.get(sessionId)
        if (retained) {
          set((s) => ({ ...documentState(retained), sessionId, status: 'ready', error: null,
            flushEditor: null, scroller: null, externalVersion: s.externalVersion + 1 }))
          setTabTitle(retained.meta!.displayName)
          await readDiskChange(sessionId, retained.mtimeMs, false)
          return
        }
        set({ status: 'loading', error: null })
        try {
          const [meta, file] = await Promise.all([requireReviewerHost().getSession(sessionId), requireReviewerHost().getFile(sessionId)])
          if (request !== loadRequest) return
          const normalized = normalizeToLf(file.content)
          const record: DocumentRecord = {
            meta, source: normalized, savedSource: normalized, eol: detectEol(file.content),
            mtimeMs: file.mtimeMs, version: file.version, revision: 0, conflictDismissed: false, recoveryError: null,
            mode: get().mode, conflict: false, saving: false, savingKind: null, notice: null,
            history: [], diskChange: null, diskGeneration: 0,
          }
          documents.set(sessionId, record)
          set((s) => ({
            ...documentState(record), sessionId, status: 'ready', error: null,
            flushEditor: null, scroller: null, externalVersion: s.externalVersion + 1,
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
        set((s) => {
          const prev = s.history.at(-1)
          if (prev === undefined) return s
          return { source: prev, history: s.history.slice(0, -1), externalVersion: s.externalVersion + 1 }
        })
        get().queueAutosave()
      },

      setSourceFromEditor(source) {
        if (get().conflict) return
        if (source === get().source) return
        set({ source })
        get().queueAutosave()
      },

      registerFlusher(fn) {
        const { sessionId, externalVersion } = get()
        set({ flushEditor: fn ? () => {
          if (get().sessionId === sessionId && get().externalVersion === externalVersion) fn()
        } : null })
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
        const s = get()
        if (mode === s.mode) return
        s.flushEditor?.()
        set({ mode })
      },

      queueAutosave() {
        const { conflict } = get()
        if (conflict) return
        const id = get().sessionId
        if (id) schedule(id)
      },

      async autosave() {
        get().flushEditor?.()
        const id = get().sessionId
        return id ? saveDocument(id) : false
      },

      adoptDiskContent(content, mtimeMs, version) {
        clearAutosave()
        const normalized = normalizeToLf(content)
        set((s) => ({
          source: normalized,
          savedSource: normalized,
          eol: detectEol(content),
          mtimeMs,
          version,
          conflict: false, conflictDismissed: false, recoveryError: null,
          externalVersion: s.externalVersion + 1,
          diskChange: null,
          // Disk adoption remains reversible so review undo can recover the discarded buffer.
          history: normalized === s.source ? s.history : [...s.history.slice(-49), s.source],
        }))
      },

      setNotice(notice) {
        set({ notice })
      },

      notifyDiskChange(mtimeMs, deleted = false) {
        const id = get().sessionId
        if (id) void readDiskChange(id, mtimeMs, deleted)
      },

      dismissDiskChange() {
        set({ diskChange: null })
      },

      async reloadFromDisk() {
        const { sessionId, revision } = get()
        if (!sessionId) return
        const record = documents.get(sessionId)!
        const request = ++record.diskGeneration
        const file = await requireReviewerHost().getFile(sessionId)
        if (record.diskGeneration === request && get().sessionId === sessionId && record.revision === revision && !record.saving) get().adoptDiskContent(file.content, file.mtimeMs, file.version)
      },

      needsAttention(id) { return !!documents.get(id)?.conflict },

      async openConflict() {
        if (get().conflict) set({ conflictDismissed: false })
      },

      closeConflict() { set({ conflictDismissed: true }) },

      async useConflictDisk() {
        const id = get().sessionId
        return id ? recover(id, 'incoming') : false
      },

      async tryMerge() {
        const id = get().sessionId
        return id ? recover(id, 'merge') : false
      },

      async saveCopy() {
        const id = get().sessionId
        const doc = id ? documents.get(id) : undefined
        const host = requireReviewerHost()
        if (!id || !doc?.conflict || doc.saving || !host.saveCopy) return null
        clearAutosave(id)
        const navigation = loadRequest
        updateDocument(id, { saving: true, savingKind: 'save', recoveryError: null })
        try {
          const copy = await host.saveCopy(id, restoreEol(doc.source, doc.eol))
          if (!copy) return null
          const source = normalizeToLf(copy.file.content)
          documents.set(copy.meta.sessionId, { ...doc, meta: copy.meta, source, savedSource: source,
            eol: detectEol(copy.file.content), version: copy.file.version, mtimeMs: copy.file.mtimeMs,
            conflict: false, conflictDismissed: false, recoveryError: null, saving: false,
            savingKind: null, diskChange: null, notice: null, history: [], diskGeneration: 0,
            pendingInvalidation: undefined, write: undefined, autosaveTimer: undefined })
          doc.diskGeneration++
          documents.delete(id)
          if (get().sessionId === id && loadRequest === navigation) await get().load(copy.meta.sessionId)
          else publish({})
          return copy.meta.sessionId
        } catch {
          updateDocument(id, { recoveryError: 'copy' })
          return null
        } finally {
          updateDocument(id, { saving: false, savingKind: null })
          const pending = doc.pendingInvalidation
          doc.pendingInvalidation = undefined
          if (documents.has(id) && pending) await readDiskChange(id, pending.mtimeMs, pending.deleted)
        }
      },

    })
  })
  return store
}

export const useDoc = createDocStore()

export function useDirty(): boolean {
  return useDoc((s) => s.source !== s.savedSource)
}
