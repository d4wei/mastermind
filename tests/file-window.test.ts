import { expect, it } from 'vitest'
import { fileWindow } from '../ui/desktop/file-window'

it('uses actual label widths and omits overflow when every file fits', () => {
  expect(fileWindow([90, 160, 105, 110, 80, 95], 0, 660, [50], 4)).toEqual({ start: 0, end: 6 })
  expect(fileWindow([], 0, 488, [50], 4)).toEqual({ start: 0, end: 0 })
})
it.each([1, 3, 12, 30, 50])('keeps the active file visible at each position among %i mixed-width files', (count) => {
  const widths = Array.from({ length: count }, (_, i) => [80, 160, 110][i % 3]!)
  for (const width of [180, 420, 760, 1200]) for (let active = 0; active < count; active++) {
    const { start, end } = fileWindow(widths, active, width, [50, 58], 4)
    expect(start).toBeLessThanOrEqual(active)
    expect(end).toBeGreaterThan(active)
    expect(end).toBeLessThanOrEqual(count)
    const size = (from: number, to: number) => {
      const visible = to - from
      const hidden = count - visible
      return widths.slice(from, to).reduce((sum, size) => sum + size, 0) + (visible - 1) * 4
        + (hidden ? (hidden < 10 ? 50 : 58) + 4 : 0)
    }
    if (end - start > 1) expect(size(start, end)).toBeLessThanOrEqual(width)
    if (start > 0) expect(size(start - 1, end)).toBeGreaterThan(width)
    if (end < count) expect(size(start, end + 1)).toBeGreaterThan(width)
  }
})
it('uses the remaining space for another short pill', () => {
  expect(fileWindow([160, 160, 90, 80, 80, 160], 0, 650, [50], 4)).toEqual({ start: 0, end: 5 })
})
it('uses the hidden count rather than the total count to size overflow', () => {
  expect(fileWindow(Array(11).fill(80), 0, 218, [50, 58], 4)).toEqual({ start: 0, end: 2 })
})
it('shrinks the active pill rather than dropping it when only one can fit', () => {
  expect(fileWindow(Array(50).fill(160), 49, 130, [50], 4)).toEqual({ start: 49, end: 50 })
})
