import type { DocStore } from '../documents/store'
import { pendingDrafts } from '../review/drafts'

/** The native host's request to close admitted documents on an agent's behalf. */
export interface CloseFilesRequest {
  request: number
  ids: string[]
}

export type CloseBlockReason = 'unsaved_edits' | 'pending_draft' | 'recovery' | 'renderer_unavailable'

export type RequestedCloseResult =
  | { id: string; status: 'closed' }
  | { id: string; status: 'blocked'; reason: CloseBlockReason }
  | { id: string; status: 'error'; error: string }

type CloseDocuments = Pick<DocStore, 'prepareToClose' | 'pendingDocuments' | 'needsAttention'>

/**
 * Closes documents an agent named without ever asking the person. Work only the person can settle
 * keeps its document open: an unfinished draft, edits that are not saved, or a recovery state.
 * `close` is the file pill's native close; it reports false when edits arrived behind the checks.
 */
export async function closeRequestedFiles(documents: CloseDocuments, ids: string[],
  admitted: ReadonlySet<string>, close: (id: string) => Promise<boolean>): Promise<RequestedCloseResult[]> {
  const known = ids.filter((id) => admitted.has(id))
  // A failed save leaves its edits pending, which the checks below report.
  await documents.prepareToClose(known).catch(() => false)
  const results: RequestedCloseResult[] = []
  for (const id of ids) {
    if (!admitted.has(id)) results.push({ id, status: 'error', error: 'document_not_open' })
    else if (pendingDrafts([id]).length) results.push({ id, status: 'blocked', reason: 'pending_draft' })
    else if (documents.pendingDocuments([id]).length) results.push({ id, status: 'blocked', reason: 'unsaved_edits' })
    else if (documents.needsAttention(id)) results.push({ id, status: 'blocked', reason: 'recovery' })
    else {
      try {
        results.push(await close(id) ? { id, status: 'closed' } : { id, status: 'blocked', reason: 'unsaved_edits' })
      } catch {
        results.push({ id, status: 'error', error: 'close_failed' })
      }
    }
  }
  return results
}

/** The answer when the reader cannot take a request, such as while the window is closing. */
export function unavailable(ids: string[]): RequestedCloseResult[] {
  return ids.map((id) => ({ id, status: 'blocked', reason: 'renderer_unavailable' }))
}
