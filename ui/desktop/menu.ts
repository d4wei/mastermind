import { navigate } from '../app/route'
import { requestViewCommand } from '../app/overlayStore'
import { useDoc, type ViewMode } from '../documents/store'
import { transferDrafts } from '../review/drafts'

/** Payloads of the native `menu-action` event; `desktop/src/menu.rs` names the same set. */
const MENU_ACTIONS = ['settings', 'close-file', 'save-copy', 'view-read', 'view-markdown', 'toggle-comments', 'resolved'] as const
export type MenuAction = typeof MENU_ACTIONS[number]

export function isMenuAction(value: unknown): value is MenuAction {
  return MENU_ACTIONS.includes(value as MenuAction)
}

/** The arguments of the native `set_menu_state` command. */
export interface MenuState {
  documentActive: boolean
  mode: ViewMode
  commentsAvailable: boolean
  commentsOpen: boolean
}

/** Saves the active document as a copy and follows it, carrying unfinished drafts along. */
async function saveActiveCopy(): Promise<void> {
  const documents = useDoc.getState()
  const original = documents.sessionId
  const copyId = await documents.saveCopy()
  if (copyId && original) transferDrafts(original, copyId)
  if (copyId && useDoc.getState().sessionId === copyId) navigate(`/d/${copyId}`)
}

/**
 * Runs a menu action against the active document. The native menu disables these items without
 * one; `documentActive` repeats that check for a click that raced the state update.
 */
export function dispatchMenuAction(action: MenuAction, documentActive: boolean, closeActiveFile: () => void): void {
  if (!documentActive) return
  switch (action) {
    case 'settings':
    case 'resolved':
    case 'toggle-comments':
      requestViewCommand(action)
      return
    case 'view-read':
      useDoc.getState().setMode('reading')
      return
    case 'view-markdown':
      useDoc.getState().setMode('source')
      return
    case 'save-copy':
      void saveActiveCopy()
      return
    case 'close-file':
      closeActiveFile()
  }
}
