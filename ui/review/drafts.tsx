import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type SetStateAction } from 'react'
import { create } from 'zustand'

const DocumentId = createContext({ id: '', name: '' })
const values = new Map<string, unknown>()
export interface ReviewDraft { id: string; key: string; label: string; discard: () => void }
const drafts = new Map<string, ReviewDraft>()
const keyFor = (id: string, key: string) => JSON.stringify([id, key])
export const useDraftFocus = create<{ target: ReviewDraft | null }>(() => ({ target: null }))

export function DraftScope({ id, name = id, children }: { id: string; name?: string; children: ReactNode }) {
  return <DocumentId.Provider value={{ id, name }}>{children}</DocumentId.Provider>
}

/** Composer state survives view unmounts, but is never written into the document implicitly. */
export function useDraftState<T>(key: string, initial: T): [T, (next: SetStateAction<T>) => void] {
  const { id } = useContext(DocumentId)
  const storageKey = keyFor(id, key)
  const [value, setValue] = useState<T>(() => id && values.has(storageKey) ? values.get(storageKey) as T : initial)
  const current = useRef(value)
  const update = (next: SetStateAction<T>) => {
    const result = typeof next === 'function' ? (next as (v: T) => T)(current.current) : next
    current.current = result
    if (id) values.set(storageKey, result)
    setValue(result)
  }
  return [value, update]
}

export function useDraftGuard(key: string, label: string, meaningful: boolean,
  focus: () => void, discard: () => void) {
  const { id, name } = useContext(DocumentId)
  const target = useDraftFocus((s) => s.target)
  useEffect(() => {
    if (!id) return
    const storageKey = keyFor(id, key)
    if (meaningful) drafts.set(storageKey, { id, key, label: `${name} · ${label}`, discard })
    else drafts.delete(storageKey)
    if (meaningful && target?.id === id && target.key === key) {
      focus()
      useDraftFocus.setState({ target: null })
    }
  })
}

export function pendingDrafts(ids?: string[]): ReviewDraft[] {
  return [...drafts.values()].filter((draft) => !ids || ids.includes(draft.id))
}
export function discardDrafts(entries: ReviewDraft[]) {
  for (const draft of entries) {
    draft.discard()
    for (const key of values.keys()) {
      const [id, field] = JSON.parse(key)
      if (id === draft.id && (field === draft.key || field.startsWith(draft.key + ':'))) values.delete(key)
    }
    drafts.delete(keyFor(draft.id, draft.key))
  }
}
export function draftValue<T>(id: string, key: string): T | undefined {
  return values.get(keyFor(id, key)) as T | undefined
}
export function releaseDrafts(id: string) {
  for (const key of values.keys()) if (JSON.parse(key)[0] === id) values.delete(key)
  for (const [key, draft] of drafts) if (draft.id === id) drafts.delete(key)
}

export function transferDrafts(from: string, to: string) {
  for (const [key, value] of [...values]) {
    const [id, field] = JSON.parse(key)
    if (id === from) { values.set(keyFor(to, field), value); values.delete(key) }
  }
  for (const [key, draft] of [...drafts]) {
    if (draft.id === from) {
      drafts.set(keyFor(to, draft.key), { ...draft, id: to })
      drafts.delete(key)
    }
  }
}
