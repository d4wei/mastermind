import type { TextEdit } from './types'

/** Apply non-overlapping edits to a string (any order; applied right-to-left). */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.from - a.from)
  let out = text
  let lastFrom = Infinity
  for (const e of sorted) {
    if (e.from > e.to) throw new Error(`invalid edit range ${e.from}..${e.to}`)
    if (e.to > lastFrom) throw new Error('overlapping edits')
    out = out.slice(0, e.from) + e.insert + out.slice(e.to)
    lastFrom = e.from
  }
  return out
}

/**
 * How far text at `point` moves once `edits` apply: the net length change of the edits ending at or
 * before it. An edit reaching past `point` is not counted; callers decide whether it invalidates
 * their position.
 */
export function shiftAt(point: number, edits: readonly TextEdit[]): number {
  let shift = 0
  for (const edit of edits) if (edit.to <= point) shift += edit.insert.length - (edit.to - edit.from)
  return shift
}
