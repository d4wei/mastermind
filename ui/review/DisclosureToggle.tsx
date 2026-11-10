import type { ReactNode } from 'react'
import { ChevronRightIcon } from '../icons'

interface Props {
  expanded: boolean
  /**
   * `reveal` shows content below, so its chevron turns from right to down, like a reply count;
   * `expand` grows content in place, so its chevron turns from down to up.
   */
  kind?: 'reveal' | 'expand'
  /** The id of the content it reveals, while that content is rendered. */
  controls?: string
  onToggle: () => void
  children: ReactNode
}

/**
 * The quiet chevron button that discloses part of a discussion card, shared by the reply count, the
 * earlier-replies row, and a resolved card's quoted passage so they cannot drift; its chevron turns
 * while expanded.
 */
export function DisclosureToggle({ expanded, kind = 'reveal', controls, onToggle, children }: Props) {
  return <button type="button" className={`rail-link rail-disclosure${kind === 'expand' ? ' rail-disclosure-expand' : ''}`} aria-expanded={expanded} aria-controls={controls}
    onClick={onToggle}>
    <ChevronRightIcon />{children}
  </button>
}
