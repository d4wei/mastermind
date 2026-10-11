export function CommentBody({ body }: { body: string }) {
  const prose = body.replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, ' '))
    .join('\n\n')
  return <div className="rail-body">{prose}</div>
}
