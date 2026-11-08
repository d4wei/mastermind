import { SearchQuery } from '@codemirror/search'
import { Text } from '@codemirror/state'

export interface Match { from: number; to: number }

const ASCII = /^[\x00-\x7f]*$/

export function isAscii(text: string): boolean {
  return ASCII.test(text)
}

export function searchQuery(query: string, caseSensitive: boolean): SearchQuery {
  return new SearchQuery({ search: query, caseSensitive, literal: true })
}

/**
 * One literal query, built once and run against many texts. CodeMirror's search defines matching:
 * it normalizes each code point (NFKD, then lowercase unless case-sensitive) and returns leftmost
 * non-overlapping matches. On ASCII text with an ASCII query that normalization is the identity or
 * ASCII lowercasing and every code point stays one unit, so a native scan returns the same matches.
 */
export class TextSearch {
  private readonly search: SearchQuery
  private readonly needle: string | null

  constructor(readonly query: string, readonly caseSensitive: boolean) {
    this.search = searchQuery(query, caseSensitive)
    this.needle = query && isAscii(query) ? caseSensitive ? query : query.toLowerCase() : null
  }

  /** `ascii` and `folded` (the lowercased text) let callers reuse what they cached per text. */
  matches(text: string, ascii = this.needle !== null && isAscii(text), folded?: string): Match[] {
    if (!this.query) return []
    const matches: Match[] = []
    if (this.needle !== null && ascii) {
      const haystack = this.caseSensitive ? text : folded ?? text.toLowerCase()
      const length = this.needle.length
      for (let at = haystack.indexOf(this.needle); at >= 0; at = haystack.indexOf(this.needle, at + length)) {
        matches.push({ from: at, to: at + length })
      }
      return matches
    }
    const cursor = this.search.getCursor(Text.of(text.split('\n')))
    for (let result = cursor.next(); !result.done; result = cursor.next()) matches.push({ from: result.value.from, to: result.value.to })
    return matches
  }
}

export function textMatches(text: string, query: string, caseSensitive: boolean): Match[] {
  return new TextSearch(query, caseSensitive).matches(text)
}
