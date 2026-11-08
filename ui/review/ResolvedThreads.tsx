import { useMemo, useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import { deleteResolvedThreadEdits, parseResolvedThreads } from '../../document/review-archive'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import type { TextEdit } from '../../document/types'
import { SlideOver } from '../app/SlideOver'
import { useT } from '../i18n'
import { AlertIcon, HistoryIcon, MoreIcon, TrashIcon } from '../icons'
import { RepliesDisclosure } from './RepliesDisclosure'
import { ThreadMessage } from './ThreadMessage'
import './ResolvedThreads.css'

interface Props {
  source: string
  onClose: () => void
  /** Paused editing keeps history readable and its delete action disabled. */
  readOnly?: boolean
  /** Applies a splice computed from `source`; the document's review-edit path owns undo and saving. */
  onEdit?: (edits: TextEdit[]) => boolean
}

export function ResolvedThreads({ source, onClose, readOnly = false, onEdit }: Props) {
  const t = useT()
  const archive = parseResolvedThreads(source)
  return (
    <SlideOver title={`${t('resolvedDiscussions')} (${archive.entries.length})`} onClose={onClose} ignoreSelector=".reader-menu" returnFocus=".topbar-overflow">
      <div className="resolved-threads">
        {archive.entries.length === 0 && archive.diagnostics.length === 0 && <div className="resolved-empty">
          <HistoryIcon />
          <p className="resolved-empty-title">{t('resolvedEmpty')}</p>
          <p>{t('resolvedEmptyHint')}</p>
        </div>}
        {archive.entries.map((entry) => <ResolvedDiscussion key={entry.range.start} context={entry.context} thread={entry.thread}
          onDelete={onEdit && !readOnly ? () => {
            const edits = deleteResolvedThreadEdits(source, entry)
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
  const quote = context && <blockquote className="rail-card-anchor" aria-label={t('resolvedContext')} title={context}>{context}</blockquote>
  const menu = <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild><button type="button" className="btn-ghost btn-icon rail-icon"
      aria-label={t('moreActions')} title={t('moreActions')}><MoreIcon /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="reader-menu" align="end" sideOffset={4}>
        <DropdownMenu.Item className="reader-menu-item" disabled={!onDelete} onSelect={() => onDelete?.()}>
          <TrashIcon />{t('deleteDiscussion')}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
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
