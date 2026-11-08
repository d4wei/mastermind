import type { ReactNode } from 'react'
import { ChevronRightIcon } from '../icons'

interface Props {
  expanded: boolean
  /** The id of the content it reveals, while that content is rendered. */
  controls?: string
  onToggle: () => void
  children: ReactNode
}

/**
 * The quiet chevron button that discloses part of a discussion card, shared by the reply count and
 * the quoted passage so they cannot drift; its chevron turns while expanded.
 */
export function DisclosureToggle({ expanded, controls, onToggle, children }: Props) {
  return <button type="button" className="rail-link rail-disclosure" aria-expanded={expanded} aria-controls={controls}
    onClick={onToggle}>
    <ChevronRightIcon />{children}
  </button>
}
