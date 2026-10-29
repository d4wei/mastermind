import { applyTextEdits, shiftAt } from '../../../document/edits'
import { scanMarkdown } from '../../../document/markdown/scan'
import { group } from '../../../document/critic/scanner'
import type { CriticSpan } from '../../../document/critic/types'
import type { TextEdit } from '../../../document/types'
import type { SelRange } from './selection'

/** Comment bodies must not contain a closer or a blank line; whitespace-only lines count as blank. */
function sanitizeComment(text: string): string {
  return text.trim().replace(/\n(?:[ \t]*\n)+/g, '\n').replaceAll('<<}', '<< }')
}

function commentMark(authorTag: string, body: string): string {
  return `{>>@${authorTag}: ${sanitizeComment(body)}<<}`
}

/**
 * Whether the comment mark stays one comment inside a plain paragraph. A continuation line that
 * opens Markdown block syntax (a list item, heading, quote, or fence) ends the paragraph, and with
 * it the mark, wherever the comment is placed.
 */
export function commentBodyFits(authorTag: string, body: string): boolean {
  const mark = commentMark(authorTag, body)
  const spans = scanMarkdown(`x${mark}`)
  return spans.length === 1 && spans[0]!.kind === 'comment' && spans[0]!.start === 1 && spans[0]!.end === 1 + mark.length
}

/** A mark an edit must produce, with offsets relative to the start of its insert. */
type IntendedSpan = Partial<CriticSpan> & Pick<CriticSpan, 'kind' | 'start' | 'end'>
interface MarkEdit { edit: TextEdit; spans: IntendedSpan[] }

const OFFSETS = ['start', 'end', 'innerStart', 'innerEnd', 'oldStart', 'oldEnd', 'newStart', 'newEnd'] as const

/** `span` moved by edits that end at or before its start; null when an edit reaches inside it. */
function mappedSpan(span: CriticSpan, edits: readonly TextEdit[]): CriticSpan | null {
  if (edits.some((edit) => edit.to > span.start && edit.from < span.end)) return null
  const shift = shiftAt(span.start, edits)
  const moved = { ...span }
  for (const key of OFFSETS) if (moved[key] !== undefined) moved[key] = moved[key] + shift
  return moved
}

function sameSpan(a: CriticSpan | undefined, b: CriticSpan): boolean {
  return !!a && a.kind === b.kind && OFFSETS.every((key) => a[key] === b[key])
}

/**
 * Surrounding Markdown can reinterpret delimiters once spliced (an unpaired backtick in the selection
 * can pair with a later one), so each edit is checked in the full edited source: every span of
 * `source` (`spans`, scanned when omitted) must reappear at its shifted offsets with the same
 * extents, and the spans starting inside each insert must be exactly its intended marks, so no
 * other span appears or disappears.
 */
function verifiedInPlace(
  source: string, spans: readonly CriticSpan[] | undefined, marks: readonly MarkEdit[], newThreads?: number,
): TextEdit[] | null {
  if (!marks.length) return []
  const edits = marks.map(({ edit }) => edit)
  const before = spans ?? scanMarkdown(source)
  const updated = applyTextEdits(source, edits)
  const after = scanMarkdown(updated)
  const intended = marks.reduce((count, mark) => count + mark.spans.length, 0)
  if (after.length !== before.length + intended) return null
  if (newThreads !== undefined && threadCount(after, updated) !== threadCount(before, source) + newThreads) return null
  const byStart = new Map(after.map((span) => [span.start, span]))
  for (const span of before) {
    const moved = mappedSpan(span, edits)
    if (!moved || !sameSpan(byStart.get(moved.start), moved)) return null
  }
  let shift = 0
  for (const { edit, spans: expected } of [...marks].sort((a, b) => a.edit.from - b.edit.from)) {
    const at = edit.from + shift
    const found = after.filter((span) => span.start >= at && span.start < at + edit.insert.length)
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

function threadCount(spans: readonly CriticSpan[], text: string): number {
  return group(spans, text).filter((item) => item.type === 'thread').length
}

/**
 * Only the first fragment anchors the discussion; extra bare highlights would be invisible.
 * Returns null when the edited source would not parse as that highlight followed by its comment,
 * or when the new discussion would join a comment already beside the selection.
 */
export function commentEdits(
  source: string, ranges: readonly SelRange[], authorTag: string, body: string, spans?: readonly CriticSpan[],
): TextEdit[] | null {
  const anchor = ranges[0]
  if (!anchor) return []
  const highlight = `{==${anchor.text}==}`
  const insert = highlight + commentMark(authorTag, body)
  return verifiedInPlace(source, spans, [{
    edit: { from: anchor.from, to: anchor.to, insert },
    spans: [
      { kind: 'highlight', start: 0, end: highlight.length, innerStart: 3, innerEnd: 3 + anchor.text.length },
      { kind: 'comment', start: highlight.length, end: insert.length },
    ],
  }], 1)
}

/** Returns null when the edited source would not parse as exactly that reply comment. */
export function replyEdits(
  source: string, at: number, authorTag: string, body: string, spans?: readonly CriticSpan[],
): TextEdit[] | null {
  const insert = commentMark(authorTag, body)
  return verifiedInPlace(source, spans, [{
    edit: { from: at, to: at, insert }, spans: [{ kind: 'comment', start: 0, end: insert.length }],
  }])
}

/** Returns null when any edited fragment would not parse as exactly its deletion or substitution. */
export function changeEdits(
  source: string, ranges: readonly SelRange[], replacements: readonly string[], spans?: readonly CriticSpan[],
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
  return verifiedInPlace(source, spans, marks)
}
