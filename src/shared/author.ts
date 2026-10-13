import { parseAuthor } from './critic/scanner'

export function usableAuthorName(value: string): string | null {
  const name = value.trim().replace(/^@/, '').trim()
  const parsed = parseAuthor(`@${name}:`)
  return parsed.author === name && parsed.body === '' ? name : null
}
