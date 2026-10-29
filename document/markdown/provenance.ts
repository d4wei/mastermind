import type { Root, Text } from 'mdast'
import { decodeString } from 'micromark-util-decode-string'
import { visit } from 'unist-util-visit'

/**
 * One stretch of a text node's value and the source it came from. A literal run's value equals its
 * source slice character for character; an atomic run is one character reference or backslash
 * escape, whose source is longer than its decoded value and is never split. Source between runs
 * (container prefixes, indentation, and whitespace before a line ending) renders as nothing.
 */
export interface TextRun {
  valueStart: number
  valueEnd: number
  sourceStart: number
  sourceEnd: number
}

/** The source runs of each text node of one reading tree, kept off the tree so its nodes stay plain mdast. */
export class TextProvenance {
  private readonly runs = new WeakMap<Text, readonly TextRun[]>()

  get(node: Text): readonly TextRun[] | undefined {
    return this.runs.get(node)
  }

  set(node: Text, runs: readonly TextRun[]): void {
    this.runs.set(node, runs)
  }
}

/** micromark's own grammar for a character escape or reference; `decodeString` decodes a match. */
const ESCAPE_OR_REFERENCE = /\\[!-/:-@[-`{-~]|&(?:#(?:\d{1,7}|[xX][\dA-Fa-f]{1,6})|[\dA-Za-z]{1,31});/y

const isLineEnding = (char: string | undefined): boolean => char === '\n' || char === '\r'

/**
 * Aligns a text node's value with its source extent `[start, end)` of `source`. The parser builds a
 * value by appending literal data, line endings, and decoded escapes and references, and drops
 * container prefixes after a line ending and whitespace before one; the alignment replays exactly
 * those steps and returns null unless they consume the value and the source completely. Escapes
 * and references decode through micromark's own decoder, so a run is atomic only where the parser
 * decoded one; an autolink's text, which the parser keeps literal, matches its source whole.
 */
export function alignText(value: string, source: string, start: number, end: number): TextRun[] | null {
  if (end - start === value.length && source.startsWith(value, start)) {
    return [{ valueStart: 0, valueEnd: value.length, sourceStart: start, sourceEnd: end }]
  }
  const runs: TextRun[] = []
  const literal = (j: number, i: number): void => {
    const last = runs.at(-1)
    if (last && last.valueEnd === j && last.sourceEnd === i && last.valueEnd - last.valueStart === last.sourceEnd - last.sourceStart) {
      last.valueEnd++
      last.sourceEnd++
    } else {
      runs.push({ valueStart: j, valueEnd: j + 1, sourceStart: i, sourceEnd: i + 1 })
    }
  }
  let i = start
  let j = 0
  while (j < value.length) {
    if (i >= end) return null
    ESCAPE_OR_REFERENCE.lastIndex = i
    const encoded = ESCAPE_OR_REFERENCE.exec(source)
    if (encoded && i + encoded[0].length <= end) {
      const decoded = decodeString(encoded[0])
      if (decoded !== encoded[0] && value.startsWith(decoded, j)) {
        runs.push({ valueStart: j, valueEnd: j + decoded.length, sourceStart: i, sourceEnd: i + encoded[0].length })
        i += encoded[0].length
        j += decoded.length
        continue
      }
    }
    const char = source[i]!
    if (char === value[j]) {
      literal(j, i)
      i++
      j++
      continue
    }
    const trailing = (char === ' ' || char === '\t') && isLineEnding(value[j])
    const prefix = (char === ' ' || char === '\t' || char === '>') && j > 0 && isLineEnding(value[j - 1])
    if (!trailing && !prefix) return null
    i++
  }
  return i === end ? runs : null
}

/** Records the runs of every positioned text node of `tree`, a parse of `source`, that aligns exactly. */
export function recordProvenance(tree: Root, source: string, provenance: TextProvenance): void {
  visit(tree, 'text', (node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return
    const runs = alignText(node.value, source, start, end)
    if (runs) provenance.set(node, runs)
  })
}

/**
 * The runs of value range `[from, to)`, rebased to start at value 0; null when either end falls
 * inside an atomic run, which has no source boundary there.
 */
export function sliceRuns(runs: readonly TextRun[], from: number, to: number): TextRun[] | null {
  const out: TextRun[] = []
  for (const run of runs) {
    if (run.valueEnd <= from || run.valueStart >= to) continue
    const atomic = run.valueEnd - run.valueStart !== run.sourceEnd - run.sourceStart
    const lo = Math.max(from, run.valueStart)
    const hi = Math.min(to, run.valueEnd)
    if (atomic && (lo !== run.valueStart || hi !== run.valueEnd)) return null
    out.push({
      valueStart: lo - from,
      valueEnd: hi - from,
      sourceStart: atomic ? run.sourceStart : run.sourceStart + lo - run.valueStart,
      sourceEnd: atomic ? run.sourceEnd : run.sourceStart + hi - run.valueStart,
    })
  }
  return out.length ? out : null
}

/** Source offset where a selection starting at value index `at` begins; null inside an atomic run. */
export function sourceStartAt(runs: readonly TextRun[], at: number): number | null {
  for (const run of runs) {
    if (at < run.valueStart || at >= run.valueEnd) continue
    if (at === run.valueStart) return run.sourceStart
    return run.valueEnd - run.valueStart === run.sourceEnd - run.sourceStart ? run.sourceStart + at - run.valueStart : null
  }
  return at === runs.at(-1)?.valueEnd ? runs.at(-1)!.sourceEnd : null
}

/** Source offset where a selection ending at value index `at` ends; null inside an atomic run. */
export function sourceEndAt(runs: readonly TextRun[], at: number): number | null {
  for (const run of runs) {
    if (at <= run.valueStart || at > run.valueEnd) continue
    if (at === run.valueEnd) return run.sourceEnd
    return run.valueEnd - run.valueStart === run.sourceEnd - run.sourceStart ? run.sourceStart + at - run.valueStart : null
  }
  return at === 0 && runs[0] ? runs[0].sourceStart : null
}
