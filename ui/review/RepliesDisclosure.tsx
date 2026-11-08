import { useId, type ReactNode } from 'react'
import { useT } from '../i18n'
import { DisclosureToggle } from './DisclosureToggle'

interface Props {
  count: number
  expanded: boolean
  onToggle: () => void
  /** The replies, rendered only while expanded. */
  children: ReactNode
}

/** The reply-count disclosure that live and resolved discussions share. */
export function RepliesDisclosure({ count, expanded, onToggle, children }: Props) {
  const t = useT()
  const id = useId()
  return <>
    <div className="rail-actions rail-footer">
      <DisclosureToggle expanded={expanded} controls={expanded ? id : undefined} onToggle={onToggle}>
        {t(count === 1 ? 'countReply' : 'countReplies').replace('{count}', String(count))}
      </DisclosureToggle>
    </div>
    {expanded && <div id={id}>{children}</div>}
  </>
}
