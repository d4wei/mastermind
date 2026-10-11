import { create } from 'zustand'
import { applyTextEdits } from '../../shared/edits'
import { detectEol, normalizeToLf, restoreEol, type Eol } from '../../shared/eol'
import type { ReviewCounts, SessionMeta, TextEdit } from '../../shared/types'
import {
  ApiError,
  getFile,
  getSession,
  postHandback,
  postRename,
  putFile,
} from './api'

export type ViewMode = 'reading' | 'source'

const AUTOSAVE_MS = 600

/** Reflect the open document in the tab title — a no-op outside a browser (tests). */
function setTabTitle(name: string): void {
  const g = globalThis as { document?: { title: string } }
  if (g.document) g.document.title = `${name} — Mastermind`
}

export interface DocStore {
  sessionId: string | null
  meta: SessionMeta | null
  /** LF-normalized source; disk writes restore the document's line endings. */
  source: string
  savedSource: string
  eol: Eol
  mtimeMs: number
  version: string
  mode: ViewMode
  status: 'loading' | 'ready' | 'error'
  error: string | null
  conflict: boolean
  saving: boolean
  /** Which write is in flight — drives button labels. */
  savingKind: 'save' | 'handback' | null
  /** Transient toast: i18n key + optional count; kind picks the style. */
  notice: { kind: 'error' | 'ok'; msg: string; count?: number } | null
  /**
   * Bumped whenever the buffer changes from OUTSIDE the active editor
   * (load, accept/reject, disk reload) — editor components remount on it.
   * Editor-originated flushes do not bump it.
   */
  externalVersion: number
  /** Registered by the active editor: flush pending edits into `source`. */
  flushEditor: (() => void) | null
  /** Registered by the Source editor: scroll to an outline heading. */
  scroller: ((offset: number, index: number) => void) | null
  /** Undo for review operations applied outside the editor. */
  history: string[]
  /** The file changed on disk under us (banner state). */
  diskChange: { mtimeMs: number; deleted: boolean; content?: string; version?: string } | null
  /** Toast after a successful hand-back (counts, localized at render). */
  handedBack: ReviewCounts | null
  /** One-shot flag: pulse the agent chip right after a local hand-back. */
  handbackPulse: boolean

  flushAll(): Promise<void>
  hasPendingWrites(): boolean
  load(sessionId: string): Promise<void>
  undo(): void
  notifyDiskChange(mtimeMs: number, deleted?: boolean): void

  dismissDiskChange(): void
  /** Discard the buffer and adopt the on-disk content. */
  reloadFromDisk(): Promise<void>
  /** Write the local buffer against a freshly read disk version. */
  saveForce(): Promise<void>
  /** Hand the document back to the waiting agent; an optional note is woven into the summary block. */
  handback(note?: string): Promise<boolean>
  clearHandedBack(): void
  setNotice(notice: DocStore['notice']): void
  /** Draft naming: first save prompts for a filename. */
  renamePrompt: boolean
  renameError: string | null
  cancelRename(): void
  completeRename(filename: string): Promise<void>
  setSource(source: string): void
  /** Editor flush path — updates the buffer without remounting the editor. */
  setSourceFromEditor(source: string): void
  registerFlusher(fn: (() => void) | null): void
  registerScroller(fn: DocStore['scroller']): void
  applyEdits(edits: TextEdit[]): void
  setMode(mode: ViewMode): void
  /** Debounced disk write triggered by every buffer edit (drafts prompt for a name first). */
  queueAutosave(): void
  /** Flush the buffer to disk now (debounced via queueAutosave; also the rename follow-up). */
  autosave(): Promise<boolean>
  /** Replace buffer + saved state from disk content (reload after external change). */
  adoptDiskContent(content: string, mtimeMs: number, version: string): void
}

type DocumentState = Pick<DocStore,
  'meta' | 'source' | 'savedSource' | 'eol' | 'mtimeMs' | 'version' | 'mode' | 'conflict' |
  'saving' | 'savingKind' | 'notice' | 'history' | 'diskChange' | 'handedBack' |
  'handbackPulse' | 'renamePrompt' | 'renameError'>

export function createDocStore() {
  const documents = new Map<string, DocumentState>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let loadRequest = 0
  const diskRequests = new Map<string, number>()
  const pendingDiskChanges = new Map<string, { mtimeMs: number; deleted: boolean }>()
  const clearAutosave = (id = store.getState().sessionId): void => {
    if (!id) return
    clearTimeout(timers.get(id))
    timers.delete(id)
  }
  const updateDocument = (id: string, patch: Partial<DocumentState>): void => {
    const doc = documents.get(id)
    if (!doc) return
    documents.set(id, { ...doc, ...patch })
    if (store.getState().sessionId === id) store.setState(patch)
  }
  const schedule = (id: string): void => {
    clearAutosave(id)
    timers.set(id, setTimeout(() => { timers.delete(id); void saveDocument(id) }, AUTOSAVE_MS))
  }
  const saveDocument = async (id: string, force = false): Promise<boolean> => {
    clearAutosave(id)
    const doc = documents.get(id)
    if (!doc || doc.saving || doc.meta?.isDraft || (!force && doc.conflict)) return false
    const { source, savedSource, eol, version } = doc
    if (source === savedSource && !force) return true
    diskRequests.set(id, (diskRequests.get(id) ?? 0) + 1)
    updateDocument(id, { saving: true, savingKind: 'save', notice: null })
    let succeeded = false
    try {
      const baseVersion = force ? (await getFile(id)).version : version
      const res = await putFile(id, restoreEol(source, eol), baseVersion)
      updateDocument(id, { savedSource: source, mtimeMs: res.mtimeMs, version: res.version, conflict: false, diskChange: null })
      succeeded = true
      return true
    } catch (err) {
      updateDocument(id, err instanceof ApiError && err.status === 409
        ? { conflict: true }
        : { notice: { kind: 'error', msg: 'saveFailed' } })
      return false
    } finally {
      diskRequests.set(id, (diskRequests.get(id) ?? 0) + 1)
      updateDocument(id, { saving: false, savingKind: null })
      const latest = documents.get(id)!
      if (succeeded && latest.source !== latest.savedSource && !latest.conflict) schedule(id)
      const pending = pendingDiskChanges.get(id)
      pendingDiskChanges.delete(id)
      if (pending) void readDiskChange(id, pending.mtimeMs, pending.deleted)
    }
  }
  const reconcileDisk = (id: string, file: Awaited<ReturnType<typeof getFile>>): void => {
    const doc = documents.get(id)
    if (!doc) return
    if (doc.version === file.version) {
      updateDocument(id, { diskChange: null })
      return
    }
    if (doc.saving) {
      pendingDiskChanges.set(id, { mtimeMs: file.mtimeMs, deleted: false })
      return
    }
    if (doc.source === doc.savedSource) {
      const normalized = normalizeToLf(file.content)
      updateDocument(id, { source: normalized, savedSource: normalized,
        eol: detectEol(file.content), mtimeMs: file.mtimeMs, version: file.version,
        conflict: false, diskChange: null })
      if (store.getState().sessionId === id) store.setState((s) => ({ externalVersion: s.externalVersion + 1 }))
    } else {
      updateDocument(id, { conflict: true, diskChange: { mtimeMs: file.mtimeMs,
        deleted: false, content: file.content, version: file.version } })
    }
  }
  const readDiskChange = async (id: string, mtimeMs: number, deleted: boolean): Promise<void> => {
    const doc = documents.get(id)
    if (!doc) return
    if (doc.saving) { pendingDiskChanges.set(id, { mtimeMs, deleted }); return }
    updateDocument(id, { diskChange: { mtimeMs, deleted } })
    const request = (diskRequests.get(id) ?? 0) + 1
    diskRequests.set(id, request)
    if (deleted) { updateDocument(id, { conflict: true }); return }
    try {
      const file = await getFile(id)
      if (diskRequests.get(id) === request) reconcileDisk(id, file)
    } catch {
      // A failed read leaves the disk-change notice available for retry.
    }
  }
  const store = create<DocStore>((set, get) => ({
    sessionId: null,
    meta: null,
    source: '',
    savedSource: '',
    eol: 'lf',
    mtimeMs: 0,
    version: '',
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
    handedBack: null,
    handbackPulse: false,
    renamePrompt: false,
    renameError: null,

    async flushAll() {
      get().flushEditor?.()
      await Promise.all([...documents.keys()].map((id) => saveDocument(id)))
    },

    hasPendingWrites() {
      return [...documents.values()].some((doc) => doc.saving || doc.source !== doc.savedSource)
    },

    async load(sessionId) {
      get().flushEditor?.()
      const request = ++loadRequest
      const retained = documents.get(sessionId)
      if (retained) {
        set((s) => ({ ...retained, sessionId, status: 'ready', error: null,
          flushEditor: null, scroller: null, externalVersion: s.externalVersion + 1 }))
        setTabTitle(retained.meta!.displayName)
        await readDiskChange(sessionId, retained.mtimeMs, false)
        return
      }
      set({ status: 'loading', error: null })
      try {
        const [meta, file] = await Promise.all([getSession(sessionId), getFile(sessionId)])
        if (request !== loadRequest) return
        const normalized = normalizeToLf(file.content)
        set((s) => ({
          sessionId, meta, source: normalized, savedSource: normalized,
          eol: detectEol(file.content), mtimeMs: file.mtimeMs, version: file.version, status: 'ready',
          conflict: false, saving: false, savingKind: null, notice: null, history: [],
          diskChange: null, handedBack: null, handbackPulse: false,
          renamePrompt: false, renameError: null, flushEditor: null, scroller: null,
          externalVersion: s.externalVersion + 1,
          mode: meta.isDraft ? 'source' : s.mode,
        }))
        setTabTitle(meta.displayName)
      } catch (err) {
        if (request !== loadRequest) return
        const message = err instanceof ApiError && err.status === 404
          ? '__session-not-found__' : err instanceof Error ? err.message : String(err)
        set({ status: 'error', error: message })
      }
    },

    setSource(source) {
      set((s) => ({
        source,
        externalVersion: s.externalVersion + 1,
        history: [...s.history.slice(-49), s.source],
      }))
      get().queueAutosave()
    },

    undo() {
      set((s) => {
        const prev = s.history.at(-1)
        if (prev === undefined) return s
        return { source: prev, history: s.history.slice(0, -1), externalVersion: s.externalVersion + 1 }
      })
      get().queueAutosave()
    },

    setSourceFromEditor(source) {
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
      const { meta, renamePrompt, conflict } = get()
      // An unnamed draft has no path to write to — ask for a filename on first edit.
      // Once named, completeRename writes and subsequent edits autosave normally.
      if (meta?.isDraft) {
        if (!renamePrompt) set({ renamePrompt: true })
        return
      }
      // Don't bury the conflict banner under retry churn — the user resolves it.
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
        conflict: false,
        externalVersion: s.externalVersion + 1,
        diskChange: null,
        // reload must be undoable: keep the discarded buffer on the stack
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
      const { sessionId, source } = get()
      if (!sessionId) return
      const request = (diskRequests.get(sessionId) ?? 0) + 1
      diskRequests.set(sessionId, request)
      const file = await getFile(sessionId)
      if (diskRequests.get(sessionId) === request && get().sessionId === sessionId && get().source === source && !get().saving) get().adoptDiskContent(file.content, file.mtimeMs, file.version)
    },

    async saveForce() {
      get().flushEditor?.()
      const id = get().sessionId
      if (id) await saveDocument(id, true)
    },

    async handback(note?: string) {
      // Cancel any pending autosave so its stale PUT can't land after handback and
      // clobber the summary block the server is about to write.
      clearAutosave()
      get().flushEditor?.()
      const { sessionId, source, eol, version, saving, meta } = get()
      if (!sessionId || saving) return false
      if (meta?.isDraft) {
        set({ renamePrompt: true })
        return false
      }
      diskRequests.set(sessionId, (diskRequests.get(sessionId) ?? 0) + 1)
      set({ saving: true, savingKind: 'handback', notice: null })
      try {
        const res = await postHandback(sessionId, restoreEol(source, eol), version, note)
        // the server appended/refreshed the summary block — adopt its content
        const file = await getFile(sessionId)
        const latest = documents.get(sessionId)!
        const normalized = normalizeToLf(file.content)
        updateDocument(sessionId, {
          savedSource: normalized, mtimeMs: file.mtimeMs, version: file.version,
          ...(latest.source === source ? { source: normalized, eol: detectEol(file.content) }
            : { conflict: true }),
          handedBack: res.counts, handbackPulse: true,
        })
        if (get().sessionId === sessionId) set((s) => ({ externalVersion: s.externalVersion + 1 }))
        return true
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          updateDocument(sessionId, { conflict: true })
          return false
        }
        updateDocument(sessionId, { notice: { kind: 'error', msg: 'handbackFailed' } })
        return false
      } finally {
        diskRequests.set(sessionId, (diskRequests.get(sessionId) ?? 0) + 1)
        updateDocument(sessionId, { saving: false, savingKind: null })
        const pending = pendingDiskChanges.get(sessionId)
        pendingDiskChanges.delete(sessionId)
        if (pending) void readDiskChange(sessionId, pending.mtimeMs, pending.deleted)
      }
    },

    clearHandedBack() {
      set({ handedBack: null, handbackPulse: false })
    },

    cancelRename() {
      set({ renamePrompt: false, renameError: null })
    },

    async completeRename(filename) {
      const { sessionId, meta } = get()
      if (!sessionId || !meta) return
      try {
        const res = await postRename(sessionId, filename)
        updateDocument(sessionId, {
          meta: { ...meta, isDraft: false, path: res.path, displayName: res.displayName },
          version: res.version,
          renamePrompt: false,
          renameError: null,
        })
        if (get().sessionId === sessionId) setTabTitle(res.displayName)
        await saveDocument(sessionId)
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          updateDocument(sessionId, { renameError: '__exists__' })
        } else {
          updateDocument(sessionId, { renameError: err instanceof Error ? err.message : String(err) })
        }
      }
    },
  }))
  store.subscribe((s) => {
    if (!s.sessionId || !s.meta) return
    const { meta, source, savedSource, eol, mtimeMs, version, mode, conflict, saving, savingKind,
      notice, history, diskChange, handedBack, handbackPulse, renamePrompt, renameError } = s
    documents.set(s.sessionId, { meta, source, savedSource, eol, mtimeMs, version, mode, conflict,
      saving, savingKind, notice, history, diskChange, handedBack, handbackPulse,
      renamePrompt, renameError })
  })
  return store
}

export const useDoc = createDocStore()

export function useDirty(): boolean {
  return useDoc((s) => s.source !== s.savedSource)
}
