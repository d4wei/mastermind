import { scanMarkdown } from '../../../document/markdown/scan'
import type { TextEdit } from '../../../document/types'
import { markEdits, type SelRange } from './selection'

/** Comment bodies must not contain a closer or a blank line. */
export function sanitizeComment(text: string): string {
  return text.trim().replace(/\n[ \t]*\n+/g, '\n').replaceAll('<<}', '<< }')
}

export function deletionWrap(text: string): string {
  return `{--${text}--}`
}

/** Only the first fragment anchors the discussion; extra bare highlights would be invisible. */
export function commentEdits(ranges: readonly SelRange[], authorTag: string, body: string): TextEdit[] {
  const safe = sanitizeComment(body)
  const anchor = ranges[0]
  if (!anchor) return []
  return markEdits([anchor], (s) => `{==${s}==}{>>@${authorTag}: ${safe}<<}`)
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
