import { expect, it } from 'vitest'
import { readingSpace } from '../ui/app/reading-space'
const base = { viewport: 1280, preferred: 736, minimum: 448, edge: 16, outline: 48, rail: 300, gap: 24 }
it('keeps the document fixed when its right margin fits the cards', () => {
  const space = { ...base, viewport: 1800 }
  expect(readingSpace(space, true).left).toBe(readingSpace(space, false).left)
})
it('balances the full group after reserving the outline strip', () => {
  const result = readingSpace(base, true)
  expect(result.width).toBe(736)
  expect(result.left - base.outline).toBe(base.viewport - result.left - result.width - result.extent)
})
it('does not reserve any comment space with the rail hidden', () => {
  const result = readingSpace(base, false)
  expect(result.extent).toBe(0)
  expect(result.left - base.outline).toBe(base.viewport - result.left - result.width)
})
it('moves comments into a panel instead of shrinking large text past its reading measure', () => {
  expect(readingSpace({ ...base, viewport: 1000, minimum: 672 }, true).panel).toBe(true)
  expect(readingSpace({ ...base, viewport: 1000 }, true).panel).toBe(false)
})
it('accommodates a preferred narrow column and an absent outline', () => {
  const result = readingSpace({ ...base, preferred: 480, outline: 0 }, true)
  expect(result.width).toBe(480)
  expect(result.left).toBe(readingSpace({ ...base, preferred: 480, outline: 0 }, false).left)
})
it('keeps tiny windows within their available width', () => {
  const result = readingSpace({ ...base, viewport: 320 }, true)
  expect(result.panel).toBe(true)
  expect(result.left + result.width).toBeLessThanOrEqual(304)
})
