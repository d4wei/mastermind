/** A CSS time token in milliseconds; null when the property is unset or not a time. */
export function cssMs(style: CSSStyleDeclaration, name: string): number | null {
  const value = style.getPropertyValue(name).trim()
  const amount = parseFloat(value)
  if (!Number.isFinite(amount)) return null
  if (value.endsWith('ms')) return amount
  return value.endsWith('s') ? amount * 1000 : null
}

/** A root time token in milliseconds, or `fallback` while it is unset, as before theme CSS loads. */
export function rootMs(name: string, fallback: number): number {
  return cssMs(getComputedStyle(document.documentElement), name) ?? fallback
}

/** A CSS length token in pixels; 0 when the property is unset or not a number. */
export function cssPx(style: CSSStyleDeclaration, name: string): number {
  return parseFloat(style.getPropertyValue(name)) || 0
}
