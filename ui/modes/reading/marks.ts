import { applyTextEdits } from '../../../document/edits'
import { scanMarkdown } from '../../../document/markdown/scan'
import type { CriticSpan } from '../../../document/critic/types'
import type { TextEdit } from '../../../document/types'
import type { SelRange } from './selection'

/** Comment bodies must not contain a closer or a blank line. */
function sanitizeComment(text: string): string {
  return text.trim().replace(/\n[ \t]*\n+/g, '\n').replaceAll('<<}', '<< }')
}

function commentMark(authorTag: string, body: string): string {
  return `{>>@${authorTag}: ${sanitizeComment(body)}<<}`
}

/** A mark an edit must produce, with offsets relative to the start of its insert. */
type IntendedSpan = Partial<CriticSpan> & Pick<CriticSpan, 'kind' | 'start' | 'end'>
interface MarkEdit { edit: TextEdit; spans: IntendedSpan[] }

/**
 * Surrounding Markdown can reinterpret delimiters once spliced (an unpaired backtick in the selection
 * can pair with a later one), so each edit is checked in the full edited source: the spans starting
 * inside its insert must be exactly the intended marks, and no other span may appear or disappear.
 */
function verifiedInPlace(source: string, marks: readonly MarkEdit[]): TextEdit[] | null {
  if (!marks.length) return []
  const edits = marks.map(({ edit }) => edit)
  const result = applyTextEdits(source, edits)
  const spans = scanMarkdown(result)
  const intended = marks.reduce((count, mark) => count + mark.spans.length, 0)
  if (spans.length !== scanMarkdown(source).length + intended) return null
  let shift = 0
  for (const { edit, spans: expected } of [...marks].sort((a, b) => a.edit.from - b.edit.from)) {
    const at = edit.from + shift
    const found = spans.filter((span) => span.start >= at && span.start < at + edit.insert.length)
    if (found.length !== expected.length) return null
    for (const [index, want] of expected.entries()) {
      const got = found[index]!
      for (const [key, value] of Object.entries(want) as [keyof CriticSpan, CriticSpan[keyof CriticSpan]][]) {
        if (got[key] !== (typeof value === 'number' ? at + value : value)) return null
      }
    }
    shift += edit.insert.length - (edit.to - edit.from)
  }
  return edits
}

/**
 * Only the first fragment anchors the discussion; extra bare highlights would be invisible.
 * Returns null when the edited source would not parse as that highlight followed by its comment.
 */
export function commentEdits(
  source: string, ranges: readonly SelRange[], authorTag: string, body: string,
): TextEdit[] | null {
  const anchor = ranges[0]
  if (!anchor) return []
  const highlight = `{==${anchor.text}==}`
  const insert = highlight + commentMark(authorTag, body)
  return verifiedInPlace(source, [{
    edit: { from: anchor.from, to: anchor.to, insert },
    spans: [
      { kind: 'highlight', start: 0, end: highlight.length, innerStart: 3, innerEnd: 3 + anchor.text.length },
      { kind: 'comment', start: highlight.length, end: insert.length },
    ],
  }])
}

/** Returns null when the edited source would not parse as exactly that reply comment. */
export function replyEdits(source: string, at: number, authorTag: string, body: string): TextEdit[] | null {
  const insert = commentMark(authorTag, body)
  return verifiedInPlace(source, [{
    edit: { from: at, to: at, insert }, spans: [{ kind: 'comment', start: 0, end: insert.length }],
  }])
}

/** Returns null when any edited fragment would not parse as exactly its deletion or substitution. */
export function changeEdits(
  source: string, ranges: readonly SelRange[], replacements: readonly string[],
): TextEdit[] | null {
  if (ranges.length !== replacements.length) return null
  const marks: MarkEdit[] = []
  for (const [index, range] of ranges.entries()) {
    const replacement = replacements[index]!
    if (replacement === range.text) continue
    // Accepting a proposal that contains marks would turn its text into new review marks.
    if (scanMarkdown(replacement).length > 0) return null
    const oldEnd = 3 + range.text.length
    if (replacement === '') {
      const insert = `{--${range.text}--}`
      marks.push({ edit: { from: range.from, to: range.to, insert },
        spans: [{ kind: 'del', start: 0, end: insert.length, innerStart: 3, innerEnd: oldEnd }] })
    } else {
      const insert = `{~~${range.text}~>${replacement}~~}`
      marks.push({ edit: { from: range.from, to: range.to, insert }, spans: [{
        kind: 'sub', start: 0, end: insert.length, oldStart: 3, oldEnd,
        newStart: oldEnd + 2, newEnd: oldEnd + 2 + replacement.length,
      }] })
    }
  }
  return verifiedInPlace(source, marks)
}
