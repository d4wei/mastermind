import type { HTMLAttributes, ReactNode } from 'react'
import { CommentBody } from './CommentBody'

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  /** The author line: a name, or a control wrapping it. */
  author: ReactNode
  /** Header controls after the author. */
  actions?: ReactNode
  /** The quoted passage; only an opening message carries one. */
  quote?: ReactNode
  body: string
  reply: boolean
}

/** One message of a discussion, shared by live and resolved cards: author, then quote, then comment. */
export function ThreadMessage({ author, actions, quote, body, reply, ...rest }: Props) {
  return <div {...rest} className={`rail-comment${reply ? ' rail-comment-reply' : ''}`}>
    <div className="rail-message-header">{author}{actions}</div>
    {quote}
    <CommentBody body={body} />
  </div>
}
