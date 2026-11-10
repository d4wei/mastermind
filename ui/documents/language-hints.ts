import { create } from 'zustand'

/**
 * The `open --document-language` hint of each open document, by session id, as the native
 * inventory reports it. The host stores nothing; a hint lasts while its document stays open.
 */
export const useDocumentLanguageHints = create<{ hints: Readonly<Record<string, string>> }>(() => ({ hints: {} }))

/** Replaces the hints with those of the documents now open; an unchanged set leaves state as it is. */
export function setDocumentLanguageHints(files: ReadonlyArray<{ id: string; document_language?: string | null }>): void {
  const hints: Record<string, string> = {}
  for (const file of files) if (file.document_language) hints[file.id] = file.document_language
  const current = useDocumentLanguageHints.getState().hints
  const keys = Object.keys(hints)
  if (keys.length === Object.keys(current).length && keys.every((id) => current[id] === hints[id])) return
  useDocumentLanguageHints.setState({ hints })
}

export function useDocumentLanguageHint(sessionId: string): string | undefined {
  return useDocumentLanguageHints((state) => state.hints[sessionId])
}
