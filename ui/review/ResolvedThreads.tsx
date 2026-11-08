import { useId, useState } from 'react'
import { parseResolvedThreads } from '../../document/review-archive'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import { SlideOver } from '../app/SlideOver'
import { useT } from '../i18n'
import { AlertIcon, HistoryIcon } from '../icons'
import { CommentBody } from './CommentBody'
import { RepliesToggle } from './RepliesToggle'
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

/** One archived discussion, laid out like a live comment card: author, quoted passage, then comment and its replies. */
function ResolvedDiscussion({ context, thread }: { context: string; thread: string }) {
  const t = useT()
  const [repliesOpen, setRepliesOpen] = useState(false)
  const repliesId = useId()
  const comments = analyzeMarkdown(thread).items.flatMap((item) => item.type === 'thread' ? item.comments : [])
  const [first, ...replies] = comments
  const quote = context && <blockquote className="rail-card-anchor" aria-label={t('resolvedContext')} title={context}>{context}</blockquote>
  const message = (comment: typeof comments[number], index: number) =>
    <div className={`rail-comment${index ? ' rail-comment-reply' : ''}`} key={index}>
      <div className="rail-message-header"><span className="rail-author">{comment.author ?? t('comment')}</span></div>
      {index === 0 && quote}
      <CommentBody body={comment.body} />
    </div>
  return (
    <article className="resolved-card" aria-label={t('resolvedOriginal')}>
      {first ? message(first, 0) : <>
        {quote}
        {/* A record whose thread no longer parses as comments still shows its stored text. */}
        <pre className="resolved-source">{thread}</pre>
      </>}
      {replies.length > 0 && <RepliesToggle count={replies.length} expanded={repliesOpen} controls={repliesId}
        onToggle={() => setRepliesOpen((open) => !open)} />}
      {repliesOpen && <div id={repliesId}>{replies.map((reply, index) => message(reply, index + 1))}</div>}
    </article>
  )
}
