export const READING_LAYOUT_EVENT = 'mastermind-reading-layout'

export interface ReadingSpace {
  viewport: number
  preferred: number
  minimum: number
  edge: number
  outline: number
  rail: number
  gap: number
}

/** Keep the reading measure centered until cards require the whole group to move. */
export function readingSpace(input: ReadingSpace, comments: boolean) {
  const { viewport, preferred, minimum, edge, outline, rail, gap } = input
  const available = Math.max(0, viewport - outline - edge * 2)
  const panel = available < Math.min(preferred, minimum) + rail + gap
  const extent = comments && !panel ? rail + gap : 0
  const width = Math.max(0, Math.min(preferred, available - extent))
  const centered = outline + edge + (available - width) / 2
  const fitsBeside = (available - width) / 2 >= extent
  const left = fitsBeside ? centered : outline + edge + (available - width - extent) / 2
  return { panel, left, width, extent }
}
