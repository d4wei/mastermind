import type { Root, RootContent } from 'mdast'
import { applyTextEdits, shiftAt } from '../../../document/edits'
import { analyzeMarkdown, type Analysis } from '../../../document/markdown/analyze'
import { scanMarkdown } from '../../../document/markdown/scan'
import { readingShape } from '../../../document/markdown/structure'
import { group } from '../../../document/critic/scanner'
import type { CriticSpan } from '../../../document/critic/types'
import type { Range } from '../../../document/critic/types'
import type { TextEdit } from '../../../document/types'
import type { SelRange } from './selection'

/**
 * The analysis of the source an edit applies to; verification analyzes the source when it is absent.
 * `block` scope needs its plain parse to find the edited blocks.
 */
export type SourceAnalysis = Pick<Analysis, 'spans' | 'tree' | 'provenance'> & Partial<Pick<Analysis, 'plain'>>

/**
 * How much of the edited source a verdict checks. `document` checks all of it and alone decides
 * submission. `block` checks only the top-level blocks that hold the edits, parsed on their own, so
 * its cost follows those blocks rather than the document; it cannot see reference definitions,
 * list items, or setext underlines outside them, so it may accept marks that `document` refuses.
 * Without the plain parse of the source, or for an edit outside every block, `block` checks the
 * whole document.
 */
export type VerifyScope = 'document' | 'block'

/**
 * Whether proposed review marks may enter the document. `markup` means the edited source would not
 * parse as exactly the intended marks beside unchanged existing ones; `formatting` means it would,
 * but the Markdown around the marks would render with a different structure.
 */
export type MarkVerdict = { edits: TextEdit[] } | { refused: 'markup' | 'formatting' }

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
 * can pair with a later one), so each edit is checked in the edited source, or under `block` scope in
 * its edited blocks: every span of `source` must reappear at its shifted offsets with the same
 * extents, and the spans starting inside each insert must be exactly its intended marks, so no other
 * span appears or disappears. The edited
 * reading tree must then match the original's structure with the new marks unwrapped, and with each
 * substitution and the source it replaces left out, so a mark cannot unlink a reference, end an
 * emphasis, or otherwise change how the Markdown it touches renders.
 */
function verifiedInPlace(
  source: string, analysis: SourceAnalysis | undefined, marks: readonly MarkEdit[], newThreads?: number,
  scope: VerifyScope = 'document',
): MarkVerdict {
  if (!marks.length) return { edits: [] }
  const edits = marks.map(({ edit }) => edit)
  const blocks = scope === 'block' && analysis?.plain ? blockWindow(source, analysis.plain, edits) : null
  if (blocks) {
    const local = marks.map(({ edit, spans }) =>
      ({ edit: { ...edit, from: edit.from - blocks.start, to: edit.to - blocks.start }, spans }))
    const verdict = verifiedInPlace(source.slice(blocks.start, blocks.end), undefined, local, newThreads)
    return 'edits' in verdict ? { edits } : verdict
  }
  const original = analysis ?? analyzeMarkdown(source)
  const before = original.spans
  const updated = applyTextEdits(source, edits)
  const edited = analyzeMarkdown(updated)
  const after = edited.spans
  const refused = { refused: 'markup' } as const
  const intended = marks.reduce((count, mark) => count + mark.spans.length, 0)
  if (after.length !== before.length + intended) return refused
  if (newThreads !== undefined && threadCount(after, updated) !== threadCount(before, source) + newThreads) return refused
  const byStart = new Map(after.map((span) => [span.start, span]))
  for (const span of before) {
    const moved = mappedSpan(span, edits)
    if (!moved || !sameSpan(byStart.get(moved.start), moved)) return refused
  }
  const added = new Set<number>()
  let shift = 0
  for (const { edit, spans: expected } of [...marks].sort((a, b) => a.edit.from - b.edit.from)) {
    const at = edit.from + shift
    const found = after.filter((span) => span.start >= at && span.start < at + edit.insert.length)
    if (found.length !== expected.length) return refused
    for (const [index, want] of expected.entries()) {
      const got = found[index]!
      added.add(after.indexOf(got))
      for (const [key, value] of Object.entries(want) as [keyof CriticSpan, CriticSpan[keyof CriticSpan]][]) {
        if (got[key] !== (typeof value === 'number' ? at + value : value)) return refused
      }
    }
    shift += edit.insert.length - (edit.to - edit.from)
  }
  // A substitution renders its old text verbatim, so only the Markdown outside it can be compared;
  // the content of a highlight or deletion must keep its own structure too.
  const replaced = marks.filter((mark) => mark.spans[0]!.kind === 'sub')
    .map(({ edit }) => ({ start: edit.from, end: edit.to }))
  if (readingShape(original.tree, original.provenance, { ranges: replaced }) !==
      readingShape(edited.tree, edited.provenance, { spanIndexes: added })) return { refused: 'formatting' }
  return { edits }
}

/**
 * The source of the top-level blocks from the first that holds an edit to the last, or null when
 * an edit lies outside every block. It starts at the line break before the first block, so the
 * slice parses from a line start and cannot open with frontmatter.
 */
function blockWindow(source: string, plain: Root, edits: readonly TextEdit[]): Range | null {
  let start = Infinity
  let end = -Infinity
  for (const edit of edits) {
    const block = blockAt(plain, edit.from, edit.to)
    if (!block) return null
    start = Math.min(start, block.position!.start.offset!)
    end = Math.max(end, block.position!.end.offset!)
  }
  const lineStart = source.lastIndexOf('\n', start - 1) + 1
  return { start: Math.max(0, lineStart - 1), end }
}

/** The top-level block holding `from` to `to`, found by bisection on the ascending block starts. */
function blockAt(plain: Root, from: number, to: number): RootContent | undefined {
  const blocks = plain.children
  let lo = 0
  let hi = blocks.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((blocks[mid]!.position?.start.offset ?? Infinity) <= from) lo = mid + 1
    else hi = mid
  }
  const block = blocks[lo - 1]
  const end = block?.position?.end.offset
  return end !== undefined && to <= end ? block : undefined
}

function threadCount(spans: readonly CriticSpan[], text: string): number {
  return group(spans, text).filter((item) => item.type === 'thread').length
}

const editsOf = (verdict: MarkVerdict): TextEdit[] | null => 'edits' in verdict ? verdict.edits : null

/**
 * Only the first fragment anchors the discussion; extra bare highlights would be invisible.
 * Refuses markup the edited source would not parse as that highlight followed by its comment, or
 * whose new discussion would join a comment already beside the selection.
 */
export function commentVerdict(
  source: string, ranges: readonly SelRange[], authorTag: string, body: string, analysis?: SourceAnalysis,
  scope?: VerifyScope,
): MarkVerdict {
  const anchor = ranges[0]
  if (!anchor) return { edits: [] }
  const highlight = `{==${anchor.text}==}`
  const insert = highlight + commentMark(authorTag, body)
  return verifiedInPlace(source, analysis, [{
    edit: { from: anchor.from, to: anchor.to, insert },
    spans: [
      { kind: 'highlight', start: 0, end: highlight.length, innerStart: 3, innerEnd: 3 + anchor.text.length },
      { kind: 'comment', start: highlight.length, end: insert.length },
    ],
  }], 1, scope)
}

/** `commentVerdict`'s edits; null when it refuses them. */
export function commentEdits(
  source: string, ranges: readonly SelRange[], authorTag: string, body: string, analysis?: SourceAnalysis,
): TextEdit[] | null {
  return editsOf(commentVerdict(source, ranges, authorTag, body, analysis))
}

/** Returns null when the edited source would not parse as exactly that reply comment in unchanged Markdown. */
export function replyEdits(
  source: string, at: number, authorTag: string, body: string, analysis?: SourceAnalysis, scope?: VerifyScope,
): TextEdit[] | null {
  const insert = commentMark(authorTag, body)
  return editsOf(verifiedInPlace(source, analysis, [{
    edit: { from: at, to: at, insert }, spans: [{ kind: 'comment', start: 0, end: insert.length }],
  }], undefined, scope))
}

/** Refuses markup unless every edited fragment parses as exactly its deletion or substitution. */
export function changeVerdict(
  source: string, ranges: readonly SelRange[], replacements: readonly string[], analysis?: SourceAnalysis,
  scope?: VerifyScope,
): MarkVerdict {
  if (ranges.length !== replacements.length) return { refused: 'markup' }
  const marks: MarkEdit[] = []
  for (const [index, range] of ranges.entries()) {
    const replacement = replacements[index]!
    if (replacement === range.text) continue
    // Accepting a proposal that contains marks would turn its text into new review marks.
    if (scanMarkdown(replacement).length > 0) return { refused: 'markup' }
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
  return verifiedInPlace(source, analysis, marks, undefined, scope)
}

/** `changeVerdict`'s edits; null when it refuses them. */
export function changeEdits(
  source: string, ranges: readonly SelRange[], replacements: readonly string[], analysis?: SourceAnalysis,
): TextEdit[] | null {
  return editsOf(changeVerdict(source, ranges, replacements, analysis))
}
