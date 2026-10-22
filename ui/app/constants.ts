export const APP_NAME = 'mastermind'

/** Neutral fallback when no configured signature or Git name is available. */
export const DEFAULT_AUTHOR_TAG = 'reviewer'

/**
 * Open overlays that own Escape; document-level Escape handlers defer to them. Each owner prevents
 * the default of the Escape it consumes, but its listener may run after theirs, so they also look here.
 */
export const ESCAPE_OWNER_SELECTOR = '.slide-over[role="dialog"], .close-dialog[open], .outline-popover'

/** The open overlay that owns Escape; one under an inert ancestor cannot take it. */
export function escapeOwner(selector = ESCAPE_OWNER_SELECTOR): Element | undefined {
  return Array.from(document.querySelectorAll(selector)).find((element) => !element.closest('[inert]'))
}
