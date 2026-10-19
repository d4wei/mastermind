import { expect, it } from 'vitest'
import { fileWindow } from '../ui/desktop/file-window'

it('keeps every file when the whole strip fits, without reserving overflow space', () => {
  expect(fileWindow(3, 2, 488, 160, 50, 4)).toEqual({ start: 0, end: 3 })
  expect(fileWindow(0, 0, 488, 160, 50, 4)).toEqual({ start: 0, end: 0 })
})
it.each([1, 3, 12, 30, 50])('keeps the active file visible at each position among %i files', (count) => {
  for (const width of [180, 420, 760, 1200]) for (let active = 0; active < count; active++) {
    const { start, end } = fileWindow(count, active, width, 160, 50, 4)
    expect(start).toBeLessThanOrEqual(active)
    expect(end).toBeGreaterThan(active)
    expect(end).toBeLessThanOrEqual(count)
    const visible = end - start
    if (visible > 1) expect(visible * 160 + (visible - 1) * 4 + (visible < count ? 54 : 0)).toBeLessThanOrEqual(width)
  }
})
it('shrinks the active pill rather than dropping it when only one can fit', () => {
  expect(fileWindow(50, 49, 130, 160, 50, 4)).toEqual({ start: 49, end: 50 })
})
