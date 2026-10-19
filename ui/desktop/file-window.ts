/** Keep a consecutive run containing the active file, in its original ordering. */
export function fileWindow(count: number, active: number, width: number, pill: number,
  overflow: number, gap: number): { start: number; end: number } {
  if (!count) return { start: 0, end: 0 }
  if (count * pill + (count - 1) * gap <= width) return { start: 0, end: count }
  const capacity = Math.max(1, Math.floor((width - overflow) / (pill + gap)))
  const start = Math.max(0, Math.min(active, count - 1) - capacity + 1)
  return { start, end: Math.min(count, start + capacity) }
}
