import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type SetStateAction } from 'react'
import { create } from 'zustand'

const DocumentId = createContext({ id: '', name: '' })
export interface ReviewDraft { id: string; key: string; label: string; discard: () => void }
/** `order` keeps drafts listed in the order they became meaningful, across documents. */
interface PendingDraft extends ReviewDraft { order: number }

/** One document's retained composer values and its meaningful unfinished drafts. */
interface DocumentDrafts {
  /** Composer values by field; a draft key owns its own field and every `key:`-prefixed field. */
  values: ReadonlyMap<string, unknown>
  /** Meaningful drafts by key. */
  pending: ReadonlyMap<string, PendingDraft>
}
interface DraftState {
  documents: ReadonlyMap<string, DocumentDrafts>
  /** The draft whose composer takes focus once its document view shows it. */
  focus: ReviewDraft | null
}

export const useDrafts = create<DraftState>(() => ({ documents: new Map(), focus: null }))
let sequence = 0
const EMPTY: DocumentDrafts = { values: new Map(), pending: new Map() }

function updateDocument(id: string, change: (drafts: DocumentDrafts) => DocumentDrafts): void {
  useDrafts.setState(({ documents }) => ({ documents: new Map(documents).set(id, change(documents.get(id) ?? EMPTY)) }))
}

export function focusDraft(draft: ReviewDraft | null): void {
  useDrafts.setState({ focus: draft })
}

export function DraftScope({ id, name = id, children }: { id: string; name?: string; children: ReactNode }) {
  return <DocumentId.Provider value={{ id, name }}>{children}</DocumentId.Provider>
}

/** Composer state survives view unmounts, but is never written into the document implicitly. */
export function useDraftState<T>(key: string, initial: T): [T, (next: SetStateAction<T>) => void] {
  const { id } = useContext(DocumentId)
  const [value, setValue] = useState<T>(() => {
    const values = useDrafts.getState().documents.get(id)?.values
    return id && values?.has(key) ? values.get(key) as T : initial
  })
  const current = useRef(value)
  const update = useCallback((next: SetStateAction<T>) => {
    const result = typeof next === 'function' ? (next as (v: T) => T)(current.current) : next
    current.current = result
    if (id) updateDocument(id, (drafts) => ({ ...drafts, values: new Map(drafts.values).set(key, result) }))
    setValue(result)
  }, [id, key])
  return [value, update]
}

export function useDraftGuard(key: string, label: string, meaningful: boolean,
  focus: () => void, discard: () => void) {
  const { id, name } = useContext(DocumentId)
  const target = useDrafts((s) => s.focus)
  useEffect(() => {
    if (!id) return
    const existing = useDrafts.getState().documents.get(id)?.pending.get(key)
    if (meaningful) {
      const draft = { id, key, label: `${name} · ${label}`, discard, order: existing?.order ?? ++sequence }
      updateDocument(id, (drafts) => ({ ...drafts, pending: new Map(drafts.pending).set(key, draft) }))
    } else if (existing) {
      updateDocument(id, (drafts) => {
        const pending = new Map(drafts.pending)
        pending.delete(key)
        return { ...drafts, pending }
      })
    }
    if (meaningful && target?.id === id && target.key === key) {
      focus()
      focusDraft(null)
    }
  })
}

/** Whether the document has a meaningful draft under `key`; re-renders when that changes. */
export function useDraftPending(id: string, key: string): boolean {
  return useDrafts((s) => !!s.documents.get(id)?.pending.has(key))
}

/** A retained composer value, read reactively outside the composer that owns it. */
export function useDraftValue<T>(id: string, key: string): T | undefined {
  return useDrafts((s) => s.documents.get(id)?.values.get(key) as T | undefined)
}

export function pendingDrafts(ids?: string[]): ReviewDraft[] {
  return [...useDrafts.getState().documents]
    .flatMap(([id, drafts]) => !ids || ids.includes(id) ? [...drafts.pending.values()] : [])
    .sort((a, b) => a.order - b.order)
}

export function discardDrafts(entries: ReviewDraft[]) {
  for (const draft of entries) {
    draft.discard()
    if (!useDrafts.getState().documents.has(draft.id)) continue
    updateDocument(draft.id, ({ values, pending }) => {
      const remaining = new Map(pending)
      remaining.delete(draft.key)
      return { values: new Map([...values].filter(([field]) => field !== draft.key && !field.startsWith(draft.key + ':'))),
        pending: remaining }
    })
  }
}

export function releaseDrafts(id: string) {
  useDrafts.setState(({ documents }) => {
    const next = new Map(documents)
    next.delete(id)
    return { documents: next }
  })
}

export function transferDrafts(from: string, to: string) {
  useDrafts.setState(({ documents }) => {
    const moved = documents.get(from)
    if (!moved) return {}
    const target = documents.get(to) ?? EMPTY
    const pending = new Map(target.pending)
    for (const draft of [...moved.pending.values()].sort((a, b) => a.order - b.order)) {
      pending.set(draft.key, { ...draft, id: to, order: target.pending.get(draft.key)?.order ?? ++sequence })
    }
    const next = new Map(documents)
    next.delete(from)
    return { documents: next.set(to, { values: new Map([...target.values, ...moved.values]), pending }) }
  })
}
