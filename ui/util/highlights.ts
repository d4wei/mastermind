/**
 * Paints ranges through the CSS Custom Highlight API, which colors text without mutating the DOM;
 * where the API is absent painting is skipped and the text stays unmarked.
 */
export function paintHighlight(name: string, ranges: readonly Range[]): void {
  if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return
  // Mutate a registered set so WebKit invalidates ranges it no longer holds.
  const highlight = CSS.highlights.get(name) ?? new Highlight()
  highlight.clear()
  for (const range of ranges) highlight.add(range)
  CSS.highlights.set(name, highlight)
}

export function clearHighlight(name: string): void {
  globalThis.CSS?.highlights?.get(name)?.clear()
  globalThis.CSS?.highlights?.delete(name)
}
