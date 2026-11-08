import type { Node, Parent } from 'unist'
import { group, parseAuthor, scan, stripLinePrefixes } from './critic/scanner'
import type { Range, ReviewItem } from './critic/types'
import { detectEol } from './eol'
import { applyTextEdits } from './edits'
import { stringifyEscaped } from './escaped-json'
import { scanMarkdown, textBlockRanges } from './markdown/scan'
import { parseMarkdown } from './markdown/processor'
import type { TextEdit } from './types'

export type ReviewThread = Extract<ReviewItem, { type: 'thread' }>
interface ResolvedThread {
  context: string
  thread: string
  authors: Array<string | null>
  range: Range
}
interface ArchiveDiagnostic {
  message: string
  range: Range
}

const MARKER = 'mastermind:resolved-thread'

export function parseResolvedThreads(source: string): { entries: ResolvedThread[]; diagnostics: ArchiveDiagnostic[] } {
  const entries: ResolvedThread[] = []
  const diagnostics: ArchiveDiagnostic[] = []
  const visit = (node: Node): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (node.type === 'html' && start !== undefined && end !== undefined) {
      const raw = source.slice(start, end)
      for (const comment of raw.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
        const rawRecord = comment[0]
        if (!rawRecord.startsWith(`<!-- ${MARKER}`)) continue
        const range = { start: start + comment.index!, end: start + comment.index! + rawRecord.length }
        const header = /^<!-- mastermind:resolved-thread v([^\s]+)\r?\n/.exec(rawRecord)
        let message: string | null = null
        if (!header || !rawRecord.endsWith('-->')) message = 'Malformed resolved-thread archive'
        else if (header[1] !== '1') message = `Unsupported resolved-thread archive version: ${header[1]}`
        else {
          try {
            const encoded = rawRecord.slice(header[0].length, -3).trim()
            const record: unknown = JSON.parse(encoded)
            if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid record')
            const value = record as Record<string, unknown>
            if (typeof value.context !== 'string' || typeof value.thread !== 'string' ||
              Object.keys(value).some((key) => !['context', 'thread'].includes(key))) throw new Error('invalid fields')
            if (/\{(?:\+\+|--|~~|==|>>)|(?:\+\+|--|~~|==|<<)\}|<!--|-->/.test(encoded)) throw new Error('unsafe delimiters')
            const authors = scan(value.thread).filter((span) => span.kind === 'comment')
              .map((span) => parseAuthor(stripLinePrefixes((value.thread as string).slice(span.innerStart, span.innerEnd))).author)
            entries.push({ context: value.context, thread: value.thread, authors, range })
          } catch {
            message = 'Malformed resolved-thread archive record'
          }
        }
        if (message) diagnostics.push({ message, range })
      }
      return
    }
    for (const child of (node as Parent).children ?? []) visit(child)
  }
  visit(parseMarkdown(source))
  return { entries, diagnostics }
}

const lineBreakAfter = (source: string, at: number) => source.startsWith('\r\n', at) ? 2 : source[at] === '\n' ? 1 : 0
const lineBreakBefore = (source: string, at: number) =>
  at >= 2 && source.startsWith('\r\n', at - 2) ? 2 : source[at - 1] === '\n' ? 1 : 0
const blankLineAt = (source: string, at: number) => /^[ \t]*(?:\r?\n|$)/.test(source.slice(at, at + 256))

/**
 * Removes one resolved-discussion record and the line breaks `resolveThreadEdits` added around it,
 * so the remaining records and text read as if it had never been resolved. A captured record that
 * no longer parses identically at its range yields no edits.
 *
 * Text directly below the record keeps a blank line between it and the text above, so removal never
 * joins blocks the record held apart. At the file tail, deletion inverts the separator resolution
 * chose for a source that did not end in the dominant line ending.
 */
export function deleteResolvedThreadEdits(source: string, entry: Pick<ResolvedThread, 'range' | 'context' | 'thread'>): TextEdit[] {
  const current = parseResolvedThreads(source).entries.find(({ range }) =>
    range.start === entry.range.start && range.end === entry.range.end)
  if (!current || current.context !== entry.context || current.thread !== entry.thread) return []
  let { start: from, end: to } = current.range
  const before = lineBreakBefore(source, from)
  const blankBefore = before && lineBreakBefore(source, from - before)
  const after = lineBreakAfter(source, to)
  if (!after) {
    // Resolution adds no final line break to a file without one, only the separation before it.
    if (to === source.length && before) from -= before + blankBefore
  } else if (before || from === 0) {
    const next = to + after
    if (!blankLineAt(source, next)) {
      // Content follows: the record's line goes only where a blank line or the file start already
      // separates that content from the text above; otherwise its line break stays as that blank line.
      if (blankBefore || from === 0) to = next
    } else {
      // The record's own line ending goes with it; so does the blank line that set it apart.
      to = next
      if (blankBefore) {
        from -= before
        // A tail ending in a bare LF under CRLF dominance received two separators, not one.
        if (next === source.length && before === 2 && blankBefore === 2 &&
          lineBreakBefore(source, from - blankBefore) === 1) from -= blankBefore
      }
    }
  }
  return [{ from, to, insert: '' }]
}

function currentThread(source: string, thread: ReviewThread): ReviewThread | null {
  const current = group(scanMarkdown(source), source)
    .find((item): item is ReviewThread => item.type === 'thread' && item.start === thread.start && item.end === thread.end)
  // Revalidate offsets and parsed comment text before splicing a captured UI thread.
  return current && JSON.stringify(current) === JSON.stringify(thread) ? current : null
}

function unwrapAnchor(thread: ReviewThread): TextEdit[] {
  const anchor = thread.anchor
  return anchor ? [{ from: anchor.start, to: anchor.innerStart, insert: '' },
    { from: anchor.innerEnd, to: anchor.end, insert: '' }] : []
}

export function deleteCommentEdits(source: string, thread: ReviewThread, commentIndex: number): TextEdit[] {
  const current = currentThread(source, thread)
  if (!current || !Number.isInteger(commentIndex)) return []
  const comment = current.comments[commentIndex]
  if (!comment) return []
  return [{ from: comment.span.start, to: comment.span.end, insert: '' },
    ...(current.comments.length === 1 ? unwrapAnchor(current) : [])]
}

function quotedContext(source: string, thread: ReviewThread): string {
  if (thread.anchor) return source.slice(thread.anchor.innerStart, thread.anchor.innerEnd)
  const block = textBlockRanges(parseMarkdown(source))
    .find(({ start, end }) => start <= thread.start && thread.start < end)
  // A validated thread came from scanMarkdown, so a block contains it; never quote unrelated text.
  if (!block) return ''
  return source.slice(block.start, thread.start) + source.slice(thread.end, block.end)
}

function encodeRecord(record: Pick<ResolvedThread, 'context' | 'thread'>): string {
  // Escaped string values keep history opaque to agents whose scanners include HTML comments.
  return stringifyEscaped(record, /[{}<>-]/g, 2)
}

export function resolveThreadEdits(source: string, thread: ReviewThread): TextEdit[] {
  const current = currentThread(source, thread)
  if (!current) return []
  const parsed = parseResolvedThreads(source)
  // Appending inside an unterminated archive would hide the new record and change its meaning.
  if (parsed.diagnostics.some(({ range }) => !source.slice(range.start, range.end).endsWith('-->'))) {
    throw new Error('Cannot resolve discussion while the document contains an unterminated archive')
  }
  const eol = detectEol(source) === 'crlf' ? '\r\n' : '\n'
  const record = encodeRecord({ context: quotedContext(source, current), thread: source.slice(current.start, current.end) }).replace(/\n/g, eol)
  const separator = source.endsWith(eol + eol) ? '' : source.endsWith(eol) ? eol : eol + eol
  const archive = `<!-- ${MARKER} v1${eol}${record}${eol}-->`
  const edits: TextEdit[] = [
    ...current.comments.map(({ span }) => ({ from: span.start, to: span.end, insert: '' })),
    ...unwrapAnchor(current),
    { from: source.length, to: source.length, insert: separator + archive + (source.endsWith('\n') ? eol : '') },
  ]
  const updated = applyTextEdits(source, edits)
  const archiveStart = updated.lastIndexOf(archive)
  const ownHtmlBlock = parseMarkdown(updated).children.some((node) => node.type === 'html' &&
    node.position?.start.offset === archiveStart && updated.slice(archiveStart, node.position.end.offset) === archive)
  if (!ownHtmlBlock) throw new Error('Cannot resolve discussion while the document ends in an unterminated code or HTML block')
  return edits
}
