import type { CriticSpan } from './types'

export interface Sentinels {
  /**
   * Two alternating chars that replace sub/comment span content — alternation
   * keeps ADJACENT spans' runs distinguishable in text-node values.
   */
  neutral: [string, string]
  open: Record<'ins' | 'del' | 'highlight', string>
  close: Record<'ins' | 'del' | 'highlight', string>
}

/** Candidate Private Use Area bases; each pool consumes 8 consecutive codepoints. */
const BASES = [0xe000, 0xe010, 0xe020, 0xe030, 0xe040]
const POOL_SIZE = 8

function sentinelsFromBase(base: number): Sentinels {
  const ch = (offset: number) => String.fromCharCode(base + offset)
  return {
    neutral: [ch(0), ch(7)],
    open: { ins: ch(1), del: ch(3), highlight: ch(5) },
    close: { ins: ch(2), del: ch(4), highlight: ch(6) },
  }
}

function pickSentinels(text: string): Sentinels {
  for (const base of BASES) {
    let clash = false
    for (let off = 0; off < POOL_SIZE && !clash; off++) {
      if (text.includes(String.fromCharCode(base + off))) clash = true
    }
    if (!clash) return sentinelsFromBase(base)
  }
  throw new Error('source uses every sentinel codepoint pool (PUA-heavy file) — cannot mask')
}

/**
 * Neutralize [start, end): every UTF-16 code unit, both halves of a surrogate
 * pair included, becomes `neutral` EXCEPT newlines and each line's leading
 * blockquote/indent prefix (`[ \t]*(> ?)*`), which must survive so block
 * structure parses identically.
 */
function neutralizeRegion(chars: string[], start: number, end: number, neutral: string): void {
  let i = start
  while (i < end) {
    const c = chars[i]!
    if (c === '\n' || c === '\r') {
      i++
      if (c === '\r') continue
      // preserve the new line's container prefix
      while (i < end && (chars[i] === ' ' || chars[i] === '\t')) i++
      while (i < end && chars[i] === '>') {
        i++
        if (i < end && chars[i] === ' ') i++
      }
      continue
    }
    chars[i] = neutral
    i++
  }
}

export interface MaskResult {
  masked: string
  sentinels: Sentinels
}

/**
 * Equal-length masking: ins/del/highlight delimiters become sentinel runs of
 * identical length (their content still parses as markdown); sub/comment
 * spans are neutralized wholesale (their content is read from the original
 * source by offset, never from the tree). Every mdast position offset in a
 * parse of `masked` is therefore valid for `text`.
 */
export function maskSource(text: string, spans: readonly CriticSpan[], sentinels?: Sentinels): MaskResult {
  const s = sentinels ?? pickSentinels(text)
  const chars = text.split('')
  let atomOrdinal = 0
  for (const span of spans) {
    if (span.kind === 'sub' || span.kind === 'comment') {
      neutralizeRegion(chars, span.start, span.end, s.neutral[(atomOrdinal++ % 2) as 0 | 1])
      continue
    }
    const open = s.open[span.kind]
    const close = s.close[span.kind]
    chars[span.start] = open
    chars[span.start + 1] = open
    chars[span.start + 2] = open
    chars[span.end - 3] = close
    chars[span.end - 2] = close
    chars[span.end - 1] = close
  }
  const masked = chars.join('')
  if (masked.length !== text.length) {
    throw new Error(`mask length invariant violated: ${masked.length} !== ${text.length}`)
  }
  return { masked, sentinels: s }
}
