import { parseTranslatedComment } from '../../document/translation'
function commentContent(body: string) {
  const translated = parseTranslatedComment(body)
  const prose = (translated?.comment ?? body).replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, ' '))
    .join('\n\n')
  return { translated, prose }
}

export function commentSearchText(body: string): string {
  const { translated, prose } = commentContent(body)
  return (translated ? `${translated.language}\n${translated.quote}` : '') + prose
}

export function CommentBody({ body }: { body: string }) {
  const { translated, prose } = commentContent(body)
  return <div className="rail-body">
    {translated && <blockquote className="translated-comment-quote"><span>{translated.language}</span>{'\n'}{translated.quote}</blockquote>}
    {prose}
  </div>
}
