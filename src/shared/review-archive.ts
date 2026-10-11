import type { Node, Parent } from 'unist'
import { group, parseAuthor, scan, stripLinePrefixes } from './critic/scanner'
import type { Range, ReviewItem } from './critic/types'
import { detectEol } from './eol'
import { applyTextEdits } from './edits'
import { codeRanges } from './markdown/exclusions'
import { parseMarkdown } from './markdown/processor'
import type { TextEdit } from './types'

export type ReviewThread = Extract<ReviewItem, { type: 'thread' }>
export interface ResolvedThread {
  context: string
  thread: string
  authors: Array<string | null>
  range: Range
}
export interface ArchiveDiagnostic {
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

function currentThread(source: string, thread: ReviewThread): ReviewThread | null {
  const current = group(scan(source, codeRanges(source)), source)
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
  const before = source.slice(0, thread.start)
  const breaks = [...before.matchAll(/\r?\n[ \t]*\r?\n/g)]
  const last = breaks.at(-1)
  const start = last ? last.index! + last[0].length : 0
  const after = source.slice(thread.end)
  const boundary = /\r?\n[ \t]*\r?\n/.exec(after)
  return source.slice(start, thread.start) + after.slice(0, boundary?.index ?? after.length)
}

function encodeRecord(record: Pick<ResolvedThread, 'context' | 'thread'>): string {
  // Escaped string values keep history opaque to agents whose scanners include HTML comments.
  return JSON.stringify(record, null, 2).replace(/"(?:[^"\\]|\\.)*"/g,
    (string) => string.replace(/[{}<>-]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`))
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
