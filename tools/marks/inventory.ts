import { pickSentinels } from '../../document/critic/mask'
import { CLOSERS, OPENERS, escapedAt, group, stripLinePrefixes, threadCards } from '../../document/critic/scanner'
import type { CriticKind, CriticSpan, Range } from '../../document/critic/types'
import { excludedRanges } from '../../document/markdown/exclusions'
import { parseMarkdown } from '../../document/markdown/processor'
import { scanMarkdownTree, textBlockRanges } from '../../document/markdown/scan'

export type MarkKind = 'insert' | 'delete' | 'substitute' | 'highlight' | 'comment'

const KIND_NAMES: Record<CriticKind, MarkKind> = {
  ins: 'insert', del: 'delete', sub: 'substitute', highlight: 'highlight', comment: 'comment',
}
const KIND_NOUNS: Record<CriticKind, string> = {
  ins: 'an insertion', del: 'a deletion', sub: 'a substitution', highlight: 'a highlight', comment: 'a comment',
}

export interface Position {
  /** 1-based line. */
  line: number
  /** 1-based column in code points, not counting a leading byte order mark. */
  column: number
  /** UTF-16 offset into the source. */
  offset: number
}

export interface Mark extends Position {
  kind: MarkKind
  /** End offset of the mark, delimiters included. */
  end: number
  /** The comment's `@name:` tag; suggestions and highlights carry none. */
  author: string | null
  /** Content with container prefixes dropped: a comment's body, or an insertion's, deletion's, or highlight's text. */
  text?: string
  old?: string
  new?: string
  /** The highlighted text a comment's discussion is anchored to. */
  anchor?: string
  /** 1-based number of the comment's discussion in document order. */
  thread?: number
}

export interface MarkProblem extends Position {
  message: string
}

export interface Inventory {
  marks: Mark[]
  problems: MarkProblem[]
}

/** Maps offsets to line and column. */
function locator(source: string): (offset: number) => Position {
  const lineStarts = [0]
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) lineStarts.push(i + 1)
  const bom = source.startsWith('\ufeff') ? 1 : 0
  return (offset) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    const lineStart = Math.max(lineStarts[lo]!, lo === 0 ? bom : 0)
    return { line: lo + 1, column: [...source.slice(lineStart, offset)].length + 1, offset }
  }
}

/**
 * The review marks the app shows for `source`, and the delimiters it leaves as literal text.
 * Marks come from the app's own Markdown scan and grouping; resolved-thread records are raw HTML,
 * which the scan treats as opaque, so they never appear as marks.
 */
export function inventoryMarks(source: string): Inventory {
  const plain = parseMarkdown(source)
  const spans = scanMarkdownTree(source, plain)
  const items = group(spans, source)
  const spanIndex = new Map(spans.map((span, index) => [span, index]))
  const threadOf = new Map<CriticSpan, number>()
  const anchorOf = new Map<CriticSpan, CriticSpan>()
  threadCards(items, spanIndex, source).forEach((card, index) => {
    for (const comment of card.thread.comments) {
      threadOf.set(comment.span, index + 1)
      if (card.thread.anchor) anchorOf.set(comment.span, card.thread.anchor)
    }
  })
  const locate = locator(source)
  const content = (start: number, end: number) => stripLinePrefixes(source.slice(start, end))
  const marks: Mark[] = []
  for (const item of items) {
    if (item.type === 'thread') {
      for (const comment of item.comments) {
        const anchor = anchorOf.get(comment.span)
        marks.push({ ...locate(comment.span.start), end: comment.span.end, kind: 'comment', author: comment.author,
          text: comment.body, ...(anchor ? { anchor: content(anchor.innerStart, anchor.innerEnd) } : {}),
          thread: threadOf.get(comment.span)! })
      }
      continue
    }
    const span = item.span
    const base = { ...locate(span.start), end: span.end, kind: KIND_NAMES[span.kind], author: null }
    marks.push(span.kind === 'sub'
      ? { ...base, old: content(span.oldStart!, span.oldEnd!), new: content(span.newStart!, span.newEnd!) }
      : { ...base, text: content(span.innerStart, span.innerEnd) })
  }
  const problems = literalDelimiters(source, plain, spans).map(({ at, message }) => ({ ...locate(at), message }))
  // `analyzeMarkdown` cannot mask marks without free sentinels and then reads the source as plain Markdown.
  if (spans.length > 0 && !pickSentinels(source)) {
    problems.unshift({ ...locate(0), message: 'the file uses nearly every Private Use Area character, so the app shows none of its marks' })
  }
  return { marks, problems }
}

const TOKENS: ReadonlyArray<{ token: string; kind: CriticKind; opener: boolean }> = [
  ...OPENERS.map(([token, kind]) => ({ token, kind, opener: true })),
  ...OPENERS.map(([, kind]) => ({ token: CLOSERS[kind], kind, opener: false })),
]

/**
 * Delimiters inside the app's review windows that form no mark: openers without a closer in their
 * block, substitutions without `~>`, stray closers, and marks written inside another mark, which
 * the scanner reads as that mark's text. Excluded source is skipped as the scanner skips it, and an
 * escaped opener's literal mark is passed over whole.
 */
function literalDelimiters(source: string, plain: ReturnType<typeof parseMarkdown>, spans: readonly CriticSpan[]) {
  const excluded = excludedRanges(plain)
  const excludedAt = (offset: number): Range | undefined => {
    let lo = 0
    let hi = excluded.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const range = excluded[mid]!
      if (offset < range.start) hi = mid - 1
      else if (offset >= range.end) lo = mid + 1
      else return range
    }
    return undefined
  }
  const problems: Array<{ at: number; message: string }> = []
  const tokenAt = (offset: number, limit: number) =>
    TOKENS.find(({ token }) => offset + token.length <= limit && source.startsWith(token, offset))
  const findIn = (token: string, from: number, limit: number): number => {
    for (let k = from; k + token.length <= limit;) {
      const found = source.indexOf(token, k)
      if (found === -1 || found + token.length > limit) return -1
      const range = excludedAt(found)
      if (!range) return found
      k = range.end
    }
    return -1
  }

  const scanSegment = (from: number, limit: number, within: CriticSpan | null) => {
    const ignoredClosers = new Set<number>()
    for (let k = from; k < limit;) {
      const range = excludedAt(k)
      if (range) { k = range.end; continue }
      const hit = tokenAt(k, limit)
      if (!hit) { k++; continue }
      const quoted = JSON.stringify(hit.token)
      if (!hit.opener) {
        if (!ignoredClosers.has(k)) {
          problems.push({ at: k, message: within
            ? `${quoted} inside ${KIND_NOUNS[within.kind]} is literal text; marks do not nest`
            : `stray ${quoted} with no matching opener in its block` })
        }
        k += hit.token.length
        continue
      }
      const closer = findIn(CLOSERS[hit.kind], k + 3, limit)
      if (escapedAt(source, k)) {
        k = closer === -1 ? k + 1 : closer + 3
        continue
      }
      if (within) {
        problems.push({ at: k, message: `${quoted} inside ${KIND_NOUNS[within.kind]} is literal text; marks do not nest` })
        k = closer === -1 ? k + 3 : closer + 3
        continue
      }
      if (hit.kind === 'sub' && closer !== -1) {
        problems.push({ at: k, message: `substitution ${quoted} has no "~>" before its ${JSON.stringify(CLOSERS.sub)}` })
        ignoredClosers.add(closer)
      } else {
        problems.push({ at: k, message: `unclosed ${quoted}: no ${JSON.stringify(CLOSERS[hit.kind])} in the same block` })
      }
      k += 3
    }
  }

  let next = 0
  for (const block of textBlockRanges(plain)) {
    let cursor = block.start
    while (next < spans.length && spans[next]!.start < block.end) {
      const span = spans[next++]!
      if (span.start < cursor) continue
      scanSegment(cursor, span.start, null)
      scanSegment(span.innerStart, span.innerEnd, span)
      cursor = span.end
    }
    scanSegment(cursor, block.end, null)
  }
  return problems.sort((a, b) => a.at - b.at)
}

/** Collapses a soft-wrapped body onto one line. */
export function flatten(text: string): string {
  return text.replace(/[ \t]*\r?\n[ \t]*/g, ' ').trim()
}

/** One line per mark: `L<line>:<col> <kind> <@author|@?> <text>`. */
export function formatMark(mark: Mark): string {
  const quote = (text: string) => JSON.stringify(flatten(text))
  const body = mark.kind === 'substitute' ? `${quote(mark.old!)} -> ${quote(mark.new!)}` : quote(mark.text!)
  const anchor = mark.anchor === undefined ? '' : ` on ${quote(mark.anchor)}`
  const thread = mark.thread === undefined ? '' : ` #${mark.thread}`
  return `L${mark.line}:${mark.column} ${mark.kind} ${mark.author === null ? '@?' : `@${mark.author}`} ${body}${anchor}${thread}`
}
