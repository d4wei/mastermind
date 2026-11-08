import { useId, type ReactNode } from 'react'
import { useT } from '../i18n'
import { ChevronRightIcon } from '../icons'

interface Props {
  count: number
  expanded: boolean
  onToggle: () => void
  /** The replies, rendered only while expanded. */
  children: ReactNode
}

/** The reply-count disclosure that live and resolved discussions share; its chevron turns when expanded. */
export function RepliesDisclosure({ count, expanded, onToggle, children }: Props) {
  const t = useT()
  const id = useId()
  return <>
    <div className="rail-actions rail-footer">
      <button type="button" className="rail-link rail-replies-toggle" aria-expanded={expanded}
        aria-controls={expanded ? id : undefined} onClick={onToggle}>
        <ChevronRightIcon />{t(count === 1 ? 'countReply' : 'countReplies').replace('{count}', String(count))}
      </button>
    </div>
    {expanded && <div id={id}>{children}</div>}
  </>
}
