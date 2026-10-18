import { SearchQuery } from '@codemirror/search'
import { Text } from '@codemirror/state'

export interface Match { from: number; to: number }

export function searchQuery(query: string, caseSensitive: boolean): SearchQuery {
  return new SearchQuery({ search: query, caseSensitive, literal: true })
}

export function textMatches(text: string, query: string, caseSensitive: boolean): Match[] {
  if (!query) return []
  const cursor = searchQuery(query, caseSensitive).getCursor(Text.of(text.split('\n')))
  const matches: Match[] = []
  for (let result = cursor.next(); !result.done; result = cursor.next()) matches.push({ from: result.value.from, to: result.value.to })
  return matches
}
