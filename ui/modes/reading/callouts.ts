export type CalloutKind = 'decisions' | 'questions' | 'todo' | 'risks'

/** Classifies a heading's text as a callout kind, or null for an ordinary heading. */
export function calloutKind(text: string): CalloutKind | null {
  const s = text.trim().toLowerCase()
  if (/^decisions?\b/.test(s)) return 'decisions'
  if (/^open\s+questions?\b/.test(s)) return 'questions'
  if (/^to-?dos?\b/.test(s)) return 'todo'
  if (/^risks?\b/.test(s)) return 'risks'
  return null
}

/** A callout heading with the blocks it governs, or one block outside any callout; `start` indexes its first block. */
export type CalloutSection<T> = { kind: CalloutKind; start: number; items: T[] } | { kind: null; start: number; items: [T] }

/**
 * Groups top-level blocks into callout sections. A callout runs from its heading until the next
 * heading of equal or higher rank. `depthOf` is a block's heading depth, or null for a non-heading;
 * `kindOf` is consulted only for headings.
 */
export function calloutSections<T>(items: readonly T[], depthOf: (item: T) => number | null,
  kindOf: (item: T) => CalloutKind | null): CalloutSection<T>[] {
  const sections: CalloutSection<T>[] = []
  let i = 0
  while (i < items.length) {
    const head = items[i]!
    const depth = depthOf(head)
    const kind = depth === null ? null : kindOf(head)
    if (depth === null || !kind) {
      sections.push({ kind: null, start: i, items: [head] })
      i++
      continue
    }
    let j = i + 1
    while (j < items.length) {
      const next = depthOf(items[j]!)
      if (next !== null && next <= depth) break
      j++
    }
    sections.push({ kind, start: i, items: items.slice(i, j) })
    i = j
  }
  return sections
}
