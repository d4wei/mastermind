import { diff3Merge } from 'node-diff3'

export type MergeResult = { kind: 'clean'; content: string } | { kind: 'conflict' | 'limit' }
const MAX_CHARACTERS = 1_000_000
const MAX_LINES = 4_000
const MAX_MATCHES = 1_000_000

function matchCount(a: string[], b: string[]): number {
  const counts = new Map<string, number>()
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1)
  return b.reduce((total, line) => total + (counts.get(line) ?? 0), 0)
}

/** Exact line tokens retain whitespace and the presence or absence of a final newline. */
export function mergeText(base: string, local: string, incoming: string): MergeResult {
  if (local === incoming || base === incoming) return { kind: 'clean', content: local }
  if (base === local) return { kind: 'clean', content: incoming }
  if ([base, local, incoming].some((text) => text.length > MAX_CHARACTERS)) return { kind: 'limit' }
  const tokenize = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const [o, a, b] = [tokenize(base), tokenize(local), tokenize(incoming)]
  const lines = [o, a, b]
  // Repeated lines multiply the LCS library's candidate work even in short documents.
  if (lines.some((value) => value.length > MAX_LINES) ||
    matchCount(o, a) + matchCount(o, b) > MAX_MATCHES) return { kind: 'limit' }
  const regions = diff3Merge(a, o, b, { excludeFalseConflicts: true })
  if (regions.some((region) => region.conflict)) return { kind: 'conflict' }
  return { kind: 'clean', content: regions.flatMap((region) => region.ok ?? []).join('') }
}
