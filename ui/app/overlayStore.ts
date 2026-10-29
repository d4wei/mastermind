import { create } from 'zustand'

/** Transient surfaces that exclude one another: opening one closes whichever else is open. */
type Overlay = 'find' | 'files' | 'language' | 'settings' | 'resolved'

interface OverlayState {
  open: Overlay | null
  /**
   * The document that opened a document-scoped overlay. Another document's view treats that
   * overlay as closed, so switching files never carries a menu or panel across.
   */
  owner: string | null
  /** Counts Find requests, so a repeated request refocuses an already open panel. */
  findRequest: number
}

export const useOverlay = create<OverlayState>(() => ({ open: null, owner: null, findRequest: 0 }))

export function openOverlay(open: Overlay, owner: string | null = null): void {
  useOverlay.setState({ open, owner })
}

/** Closes whichever of `overlays` is open, so a late dismissal never closes its successor. */
export function closeOverlay(...overlays: Overlay[]): void {
  const { open } = useOverlay.getState()
  if (open && overlays.includes(open)) useOverlay.setState({ open: null, owner: null })
}

/** Whether `overlay` is open for the document `owner`. */
export function useOverlayOpen(overlay: Overlay, owner: string | null = null): boolean {
  return useOverlay((s) => s.open === overlay && s.owner === owner)
}

/** Opens or refocuses Find for the active document. */
export function requestFind(): void {
  useOverlay.setState((s) => ({ open: 'find', owner: null, findRequest: s.findRequest + 1 }))
}
