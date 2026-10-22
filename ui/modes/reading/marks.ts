import { scanMarkdown } from '../../../document/markdown/scan'
import type { TextEdit } from '../../../document/types'
import type { SelRange } from './selection'

/** Comment bodies must not contain a closer or a blank line. */
function sanitizeComment(text: string): string {
  return text.trim().replace(/\n[ \t]*\n+/g, '\n').replaceAll('<<}', '<< }')
}

function deletionWrap(text: string): string {
  return `{--${text}--}`
}

export function commentMark(authorTag: string, body: string): string {
  return `{>>@${authorTag}: ${sanitizeComment(body)}<<}`
}

/**
 * Only the first fragment anchors the discussion; extra bare highlights would be invisible.
 * Returns null when the insert would not reparse as that highlight followed by its comment.
 */
export function commentEdits(ranges: readonly SelRange[], authorTag: string, body: string): TextEdit[] | null {
  const anchor = ranges[0]
  if (!anchor) return []
  const insert = `{==${anchor.text}==}${commentMark(authorTag, body)}`
  const [highlight, comment, ...rest] = scanMarkdown(insert)
  if (rest.length || highlight?.kind !== 'highlight' || comment?.kind !== 'comment' || highlight.start !== 0 ||
    insert.slice(highlight.innerStart, highlight.innerEnd) !== anchor.text ||
    comment.start !== highlight.end || comment.end !== insert.length) return null
  return [{ from: anchor.from, to: anchor.to, insert }]
}

export function changeEdits(ranges: readonly SelRange[], replacements: readonly string[]): TextEdit[] | null {
  if (ranges.length !== replacements.length) return null
  const edits: TextEdit[] = []
  for (const [index, range] of ranges.entries()) {
    const replacement = replacements[index]!
    if (replacement === range.text) continue
    if (scanMarkdown(replacement).length > 0) return null
    const insert = replacement === '' ? deletionWrap(range.text) : `{~~${range.text}~>${replacement}~~}`
    const spans = scanMarkdown(insert)
    const span = spans[0]
    // Require an exact round trip: delimiters in the proposal must not truncate or split a mark.
    if (spans.length !== 1 || !span || span.start !== 0 || span.end !== insert.length) return null
    if (replacement !== '' && (span.kind !== 'sub' ||
      insert.slice(span.oldStart, span.oldEnd) !== range.text ||
      insert.slice(span.newStart, span.newEnd) !== replacement)) return null
    if (replacement === '' && span.kind !== 'del') return null
    edits.push({ from: range.from, to: range.to, insert })
  }
  return edits
}
