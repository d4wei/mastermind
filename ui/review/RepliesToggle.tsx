import { useT } from '../i18n'
import { ChevronRightIcon } from '../icons'

interface Props {
  count: number
  expanded: boolean
  /** The id of the element listing the replies, referenced while it is shown. */
  controls: string
  onToggle: () => void
}

/** The reply-count disclosure that live and resolved discussions share; its chevron turns when expanded. */
export function RepliesToggle({ count, expanded, controls, onToggle }: Props) {
  const t = useT()
  return <div className="rail-actions rail-footer">
    <button type="button" className="rail-replies-toggle" aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined} onClick={onToggle}>
      <ChevronRightIcon />{t(count === 1 ? 'countReply' : 'countReplies').replace('{count}', String(count))}
    </button>
  </div>
}
