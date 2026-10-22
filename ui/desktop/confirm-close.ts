import type { DocStore } from '../documents/store'
import { discardDrafts, focusDraft, pendingDrafts } from '../review/drafts'
import { askToClose, useClosePrompt } from './CloseDialog'

const CLOSE_PROGRESS_DELAY_MS = 400

async function finishSaves(documents: DocStore, ids?: string[]): Promise<boolean> {
  let showingProgress = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancelled = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      showingProgress = true
      void askToClose({ kind: 'saving', names: [] }).then(() => resolve(false))
    }, CLOSE_PROGRESS_DELAY_MS)
  })
  try { return await Promise.race([documents.prepareToClose(ids).then(() => true), cancelled]) }
  finally {
    clearTimeout(timer)
    if (showingProgress) useClosePrompt.getState().choose('cancel')
  }
}

/** Approval belongs to the revisions shown in the dialog, not to future edits in those files. */
export async function confirmClose(documents: DocStore, ids: string[] | undefined,
  resume: (id: string) => void): Promise<Map<string, number> | null> {
  const drafts = pendingDrafts(ids)
  if (drafts.length) {
    const choice = await askToClose({ kind: 'draft', names: drafts.map((draft) => draft.label) })
    if (choice === 'cancel') {
      const draft = drafts[0]!
      focusDraft(draft)
      resume(draft.id)
      return null
    }
    discardDrafts(drafts)
  }
  if (!await finishSaves(documents, ids)) return null
  const allowed = new Map<string, number>()
  let copyFailed = false
  for (;;) {
    const pending = documents.pendingDocuments(ids).filter((doc) => allowed.get(doc.id) !== doc.revision)
    if (!pending.length) return allowed
    const choice = await askToClose({ kind: 'save', names: pending.map((doc) => doc.name), copyFailed })
    if (choice === 'cancel') { resume(pending[0]!.id); return null }
    if (choice === 'discard') {
      pending.forEach((doc) => allowed.set(doc.id, doc.revision))
    } else {
      copyFailed = false
      for (const doc of pending) {
        // A document saved or reverted while an earlier Save As dialog was open needs no copy.
        if (!documents.pendingDocuments(ids).some((item) => item.id === doc.id)) continue
        if (!await documents.saveCopy(doc.id, true)) {
          copyFailed = !!documents.pendingDocuments(ids).find((item) => item.id === doc.id)?.copyFailed
          break
        }
        allowed.set(doc.id, doc.revision)
      }
    }
  }
}
