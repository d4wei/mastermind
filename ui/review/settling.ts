/**
 * Marks an element that is shrinking toward a known size: the value is its margin box's height, in
 * pixels, once the shrink ends. A closing `Collapsible` settles to 0; a passage easing to a
 * shorter clamp settles to that clamp. The rail reads it to place cards by the heights they keep.
 */
export const SETTLES_TO = 'data-settles-to'

function marginBox(element: HTMLElement): number {
  const style = getComputedStyle(element)
  return element.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0)
}

/** The margin-box height `element` will have once its shrink ends, for marking it with `SETTLES_TO`. */
export function settledMarginBox(element: HTMLElement, height: number): number {
  return marginBox(element) - element.getBoundingClientRect().height + height
}

/**
 * `height` of `container` less what its shrinking descendants are still to lose. Only outermost
 * marks count, since a shrinking section's own content leaves with it.
 */
export function settledHeight(container: HTMLElement, height: number): number {
  let losing = 0
  for (const element of container.querySelectorAll<HTMLElement>(`[${SETTLES_TO}]`)) {
    if (element.parentElement?.closest(`[${SETTLES_TO}]`)) continue
    losing += Math.max(0, marginBox(element) - (Number(element.getAttribute(SETTLES_TO)) || 0))
  }
  return height - losing
}
