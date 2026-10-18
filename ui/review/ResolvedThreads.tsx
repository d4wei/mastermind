import { parseResolvedThreads } from '../../document/review-archive'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import { SlideOver } from '../app/SlideOver'
import { useT } from '../i18n'
import { CommentBody } from './CommentBody'
import './ResolvedThreads.css'

export function ResolvedThreads({ source, onClose }: { source: string; onClose: () => void }) {
  const t = useT()
  const archive = parseResolvedThreads(source)
  return (
    <SlideOver title={`${t('resolvedDiscussions')} (${archive.entries.length})`} onClose={onClose} ignoreSelector=".reader-menu" returnFocusSelector=".topbar-overflow">
      <div className="resolved-threads">
        {archive.entries.length === 0 && archive.diagnostics.length === 0 && <p>{t('resolvedEmpty')}</p>}
        {archive.entries.map((entry) => (
          <section className="resolved-thread" key={entry.range.start}>
            <h3>{t('resolvedContext')}</h3>
            <div className="resolved-context">{entry.context}</div>
            {analyzeMarkdown(entry.thread).items.flatMap((item) => item.type === 'thread' ? item.comments : []).map((comment, index) => (
              <div className="resolved-comment" key={index}>
                {comment.author && <span className="rail-author">@{comment.author}</span>}
                <CommentBody body={comment.body} />
              </div>
            ))}
            <details>
              <summary>{t('resolvedOriginal')}</summary>
              <pre>{entry.thread}</pre>
            </details>
          </section>
        ))}
        {archive.diagnostics.map((diagnostic) => (
          <section className="resolved-thread resolved-diagnostic" key={diagnostic.range.start}>
            <h3>{t('resolvedUnknown')}</h3>
            <p>{diagnostic.message}</p>
            <pre>{source.slice(diagnostic.range.start, diagnostic.range.end)}</pre>
          </section>
        ))}
      </div>
    </SlideOver>
  )
}
