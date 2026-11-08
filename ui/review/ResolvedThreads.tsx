import { useId, useState } from 'react'
import { parseResolvedThreads } from '../../document/review-archive'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import { SlideOver } from '../app/SlideOver'
import { useT } from '../i18n'
import { AlertIcon, ChevronRightIcon, CodeIcon, HistoryIcon } from '../icons'
import { CommentBody } from './CommentBody'
import './ResolvedThreads.css'

export function ResolvedThreads({ source, onClose }: { source: string; onClose: () => void }) {
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
        {archive.entries.map((entry) => <ResolvedDiscussion key={entry.range.start} context={entry.context} thread={entry.thread} />)}
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

/** One archived discussion: its quoted passage, opening comment, and on request its replies and Markdown source. */
function ResolvedDiscussion({ context, thread }: { context: string; thread: string }) {
  const t = useT()
  const [repliesOpen, setRepliesOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const repliesId = useId()
  const sourceId = useId()
  const comments = analyzeMarkdown(thread).items.flatMap((item) => item.type === 'thread' ? item.comments : [])
  const [first, ...replies] = comments
  const replyCount = t(replies.length === 1 ? 'countReply' : 'countReplies').replace('{count}', String(replies.length))
  // A record whose thread no longer parses as comments still shows its stored text.
  const showSource = sourceOpen || !first
  const message = (comment: typeof comments[number], index: number) =>
    <div className={`resolved-comment${index ? ' resolved-reply' : ''}`} key={index}>
      <div className="rail-message-header">
        <span className="rail-author">{comment.author ?? t('comment')}</span>
        {index === 0 && <button type="button" className="btn-ghost btn-icon rail-icon resolved-source-toggle"
          aria-expanded={sourceOpen} aria-controls={sourceOpen ? sourceId : undefined} aria-label={t('markdownSource')}
          title={t('markdownSource')} onClick={() => setSourceOpen((open) => !open)}><CodeIcon /></button>}
      </div>
      <CommentBody body={comment.body} />
    </div>
  return (
    <article className="resolved-card" aria-label={t('resolvedOriginal')}>
      {context && <blockquote className="resolved-quote" aria-label={t('resolvedContext')} title={context}>{context}</blockquote>}
      {first && message(first, 0)}
      {replies.length > 0 && <div className="rail-actions rail-footer resolved-footer">
        <button type="button" className="resolved-toggle" aria-expanded={repliesOpen}
          aria-controls={repliesOpen ? repliesId : undefined} onClick={() => setRepliesOpen((open) => !open)}>
          <ChevronRightIcon />{replyCount}
        </button>
      </div>}
      {repliesOpen && <div id={repliesId}>{replies.map((reply, index) => message(reply, index + 1))}</div>}
      {showSource && <pre className="resolved-source" id={sourceId}>{thread}</pre>}
    </article>
  )
}
