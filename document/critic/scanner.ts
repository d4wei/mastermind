import type { CommentEntry, CriticKind, CriticSpan, Range, ReviewItem } from './types'

const OPENERS: ReadonlyArray<readonly [string, CriticKind]> = [
  ['{++', 'ins'],
  ['{--', 'del'],
  ['{~~', 'sub'],
  ['{==', 'highlight'],
  ['{>>', 'comment'],
]

const CLOSERS: Record<CriticKind, string> = {
  ins: '++}',
  del: '--}',
  sub: '~~}',
  highlight: '==}',
  comment: '<<}',
}

function makeExcludeLookup(exclude: readonly Range[]): (pos: number) => Range | null {
  const sorted = [...exclude].sort((a, b) => a.start - b.start)
  return (pos: number) => {
    let lo = 0
    let hi = sorted.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const r = sorted[mid]!
      if (pos < r.start) hi = mid - 1
      else if (pos >= r.end) lo = mid + 1
      else return r
    }
    return null
  }
}

function escapedAt(text: string, bracePos: number): boolean {
  let backslashes = 0
  while (bracePos - 1 - backslashes >= 0 && text[bracePos - 1 - backslashes] === '\\') backslashes++
  return backslashes % 2 === 1
}

/**
 * Scan raw text for CriticMarkup spans.
 *
 * Rules: both delimiters of a span sit inside one of the `within` windows
 * (sorted, non-overlapping; the whole text by default) and outside every
 * `exclude` range (code, html); `\{` defeats an opener; marks do not nest —
 * the first valid closer wins. Markdown block boundaries are the caller's
 * windows: see `scanMarkdown`.
 */
export function scan(
  text: string,
  exclude: readonly Range[] = [],
  within: readonly Range[] = [{ start: 0, end: text.length }],
): CriticSpan[] {
  const spans: CriticSpan[] = []
  const excludeAt = makeExcludeLookup(exclude)

  const findToken = (token: string, from: number, limit: number): number => {
    let k = from
    while (k < limit) {
      const j = text.indexOf(token, k)
      if (j === -1 || j + token.length > limit) return -1
      const ex = excludeAt(j)
      if (ex) {
        k = ex.end
        continue
      }
      return j
    }
    return -1
  }

  for (const { start, end: limit } of within) {
    let i = start
    while (i < limit) {
      const brace = text.indexOf('{', i)
      if (brace === -1 || brace >= limit) break
      i = brace

      const ex = excludeAt(i)
      if (ex) {
        i = ex.end
        continue
      }
      if (escapedAt(text, i)) {
        i += 1
        continue
      }

      const opener = OPENERS.find(([tok]) => text.startsWith(tok, i))
      if (!opener) {
        i += 1
        continue
      }
      const kind = opener[1]
      const innerStart = i + 3

      if (kind === 'sub') {
        const firstCloser = findToken(CLOSERS.sub, innerStart, limit)
        const sep = findToken('~>', innerStart, limit)
        if (firstCloser === -1 || sep === -1 || sep >= firstCloser) {
          i += 1
          continue
        }
        spans.push({
          kind,
          start: i,
          end: firstCloser + 3,
          innerStart,
          innerEnd: firstCloser,
          oldStart: innerStart,
          oldEnd: sep,
          newStart: sep + 2,
          newEnd: firstCloser,
        })
        i = firstCloser + 3
        continue
      }

      const closer = findToken(CLOSERS[kind], innerStart, limit)
      if (closer === -1) {
        i += 1
        continue
      }
      spans.push({ kind, start: i, end: closer + 3, innerStart, innerEnd: closer })
      i = closer + 3
    }
  }
  return spans
}

const AUTHOR_RE = /^\s*@([^:@{}<>=|\x00-\x1f\u2028\u2029]{1,64}):\s?/

/**
 * Drop container prefixes (`> `, continuation indent) from a raw multi-line
 * span slice — they're markdown plumbing, not content.
 */
export function stripLinePrefixes(s: string): string {
  return s.replace(/\n[ \t]*(?:>[ \t]?)*/g, '\n')
}

export function parseAuthor(content: string): { author: string | null; body: string } {
  const m = AUTHOR_RE.exec(content)
  const author = m?.[1]?.trim()
  if (!m || !author) return { author: null, body: content }
  return { author, body: content.slice(m[0].length) }
}

function toEntry(span: CriticSpan, text: string): CommentEntry {
  const { author, body } = parseAuthor(stripLinePrefixes(text.slice(span.innerStart, span.innerEnd)))
  return { span, author, body }
}

/** The run of comments starting at `spans[from]` whose marks abut, beginning at offset `at`. */
function adjacentComments(spans: readonly CriticSpan[], from: number, at: number, text: string) {
  const comments: CommentEntry[] = []
  let next = from
  let end = at
  while (spans[next]?.kind === 'comment' && spans[next]!.start === end) {
    comments.push(toEntry(spans[next]!, text))
    end = spans[next]!.end
    next++
  }
  return { comments, next, end }
}

/**
 * Group scanned spans into review items: ins/del/sub → suggestions;
 * `{==x==}{>>c<<}` → anchored thread; consecutive comments → one thread;
 * highlights without a trailing comment → standalone highlights.
 * Adjacency means zero characters between marks.
 */
export function group(spans: readonly CriticSpan[], text: string): ReviewItem[] {
  const items: ReviewItem[] = []
  let i = 0
  while (i < spans.length) {
    const s = spans[i]!
    if (s.kind === 'ins' || s.kind === 'del' || s.kind === 'sub') {
      items.push({ type: 'suggestion', span: s })
      i++
      continue
    }
    const anchor = s.kind === 'highlight' ? s : null
    const run = adjacentComments(spans, anchor ? i + 1 : i, anchor ? s.end : s.start, text)
    if (anchor && run.comments.length === 0) items.push({ type: 'highlight', span: s })
    else items.push({ type: 'thread', anchor, comments: run.comments, start: s.start, end: run.end })
    i = run.next
  }
  return items
}
