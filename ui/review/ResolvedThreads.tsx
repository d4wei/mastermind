import { useMemo, useState } from 'react'
import type { Root } from 'mdast'
import { deleteResolvedThreadEdits, parseResolvedThreads } from '../../document/review-archive'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import type { TextEdit } from '../../document/types'
import { SlideOver } from '../app/SlideOver'
import { useT } from '../i18n'
import { AlertIcon, HistoryIcon } from '../icons'
import { DiscussionMenu } from './DiscussionMenu'
import { RepliesDisclosure } from './RepliesDisclosure'
import { ThreadMessage } from './ThreadMessage'
import { QuotedPassage } from './QuotedPassage'
import './ResolvedThreads.css'

interface Props {
  source: string
  /** The plain parse of exactly `source`, when the view holds one, so the panel parses nothing itself. */
  plain?: Root
  onClose: () => void
  /** Paused editing keeps history readable and its delete action disabled. */
  readOnly?: boolean
  /** Applies a splice computed from `source`; the document's review-edit path owns undo and saving. */
  onEdit?: (edits: TextEdit[]) => boolean
}

/**
 * Keys each record by its quoted passage and discussion, which deleting another record leaves
 * unchanged, so no card inherits a removed card's state; identical records add their offsets.
 */
function recordKeys(entries: readonly { context: string; thread: string; range: { start: number } }[]): string[] {
  const identities = entries.map((entry) => `${entry.context}\u0000${entry.thread}`)
  const counts = new Map<string, number>()
  for (const identity of identities) counts.set(identity, (counts.get(identity) ?? 0) + 1)
  return identities.map((identity, index) => counts.get(identity) === 1
    ? identity : `${identity}\u0000${entries[index]!.range.start}`)
}

export function ResolvedThreads({ source, plain, onClose, readOnly = false, onEdit }: Props) {
  const t = useT()
  const archive = useMemo(() => parseResolvedThreads(source, plain), [source, plain])
  const keys = recordKeys(archive.entries)
  return (
    <SlideOver title={`${t('resolvedDiscussions')} (${archive.entries.length})`} onClose={onClose} ignoreSelector=".reader-menu" returnFocus=".topbar-overflow">
      <div className="resolved-threads">
        {archive.entries.length === 0 && archive.diagnostics.length === 0 && <div className="resolved-empty">
          <HistoryIcon />
          <p className="resolved-empty-title">{t('resolvedEmpty')}</p>
          <p>{t('resolvedEmptyHint')}</p>
        </div>}
        {archive.entries.map((entry, index) => <ResolvedDiscussion key={keys[index]} context={entry.context} thread={entry.thread}
          onDelete={onEdit && !readOnly ? () => {
            const edits = deleteResolvedThreadEdits(source, entry, plain)
            if (edits.length) onEdit(edits)
          } : undefined} />)}
        {archive.diagnostics.map((diagnostic) => (
          <section className="resolved-card resolved-diagnostic" key={diagnostic.range.start}>
            <p className="resolved-diagnostic-title"><AlertIcon />{t('resolvedUnknown')}</p>
            <p>{diagnostic.message}</p>
            <pre className="resolved-source">{source.slice(diagnostic.range.start, diagnostic.range.end)}</pre>
          </section>
        ))}
      </div>
    </SlideOver>
  )
}

/**
 * One archived discussion, laid out like a live comment card: author, quoted passage, then comment
 * and its replies. Without `onDelete` its menu's Delete is disabled.
 */
function ResolvedDiscussion({ context, thread, onDelete }: { context: string; thread: string; onDelete?: () => void }) {
  const t = useT()
  const [repliesOpen, setRepliesOpen] = useState(false)
  const comments = useMemo(() => analyzeMarkdown(thread).items.flatMap((item) => item.type === 'thread' ? item.comments : []), [thread])
  const [first, ...replies] = comments
  const quote = context && <QuotedPassage as="blockquote" text={context} lines={6} expandable aria-label={t('resolvedContext')} />
  const menu = <DiscussionMenu label={t('deleteDiscussion')} disabled={!onDelete} onSelect={() => onDelete?.()} />
  const message = (comment: typeof comments[number], index: number) =>
    <ThreadMessage key={index} reply={index > 0} body={comment.body} quote={index === 0 ? quote : undefined}
      author={<span className="rail-author">{comment.author ?? t('comment')}</span>} actions={index === 0 ? menu : undefined} />
  return (
    <article className="resolved-card" aria-label={t('resolvedOriginal')}>
      {first ? message(first, 0) : <>
        <div className="rail-message-header"><span className="rail-author">{t('resolvedOriginal')}</span>{menu}</div>
        {quote}
        {/* A record whose thread no longer parses as comments still shows its stored text. */}
        <pre className="resolved-source">{thread}</pre>
      </>}
      {replies.length > 0 && <RepliesDisclosure count={replies.length} expanded={repliesOpen}
        onToggle={() => setRepliesOpen((open) => !open)}>
        {replies.map((reply, index) => message(reply, index + 1))}
      </RepliesDisclosure>}
    </article>
  )
}
