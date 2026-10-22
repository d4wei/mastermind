/**
 * `JSON.stringify` whose string values carry every character matched by the
 * global regex `unsafe` as a `\uXXXX` escape. Structural JSON characters stay
 * literal, and `JSON.parse` restores the original strings.
 */
export function stringifyEscaped(value: unknown, unsafe: RegExp, indent?: number): string {
  return JSON.stringify(value, null, indent).replace(/"(?:[^"\\]|\\.)*"/g,
    (string) => string.replace(unsafe, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`))
}
