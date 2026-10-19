/** Keep a consecutive run containing the active file, in its original ordering. */
export function fileWindow(widths: number[], active: number, width: number,
  overflowWidths: number[], gap: number): { start: number; end: number } {
  const count = widths.length
  if (!count) return { start: 0, end: 0 }
  if (widths.reduce((sum, size) => sum + size, 0) + (count - 1) * gap <= width) {
    return { start: 0, end: count }
  }
  let start = Math.max(0, Math.min(active, count - 1))
  let end = start + 1
  let used = widths[start]!
  const fits = (size: number) => {
    const visible = end - start + 1
    const hidden = count - visible
    const overflow = hidden ? overflowWidths[String(hidden).length - 1] ?? overflowWidths.at(-1) ?? 0 : 0
    return used + size + (visible - 1) * gap + (hidden ? overflow + gap : 0) <= width
  }
  for (;;) {
    if (start > 0 && fits(widths[start - 1]!)) { used += widths[--start]!; continue }
    if (end < count && fits(widths[end]!)) { used += widths[end++]!; continue }
    return { start, end }
  }
}
