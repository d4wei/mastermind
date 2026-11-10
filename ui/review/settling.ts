/**
 * Marks an element easing toward a known size. A number is its margin box's height, in pixels, once
 * a shrink ends: a closing `Collapsible` settles to 0, and a passage easing back to its clamp settles
 * to that clamp. `SETTLES_OPEN` marks a section opening to its content's full height, which its
 * `SETTLES_CONTENT` child holds while the section is still short of it. The rail reads both to place
 * cards by the heights they settle at.
 */
export const SETTLES_TO = 'data-settles-to'
export const SETTLES_OPEN = 'open'
/** The child of an opening section whose border box is the content's full height. */
export const SETTLES_CONTENT = 'data-settles-content'

/** The sum of `element`'s vertical margins. */
export function margins(element: HTMLElement): number {
  const style = getComputedStyle(element)
  return (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0)
}

/** The margin-box height `element` will have once its shrink to `height` ends, for `SETTLES_TO`. */
export function settledMarginBox(element: HTMLElement, height: number): number {
  return height + margins(element)
}

/** The margin-box height a marked element settles at. */
function target(element: HTMLElement, mark: string): number {
  if (mark !== SETTLES_OPEN) return Number(mark) || 0
  const content = element.querySelector<HTMLElement>(`[${SETTLES_CONTENT}]`)
  return (content?.getBoundingClientRect().height ?? 0) + margins(element)
}

/**
 * `height` of `container` once its easing descendants settle: less what shrinking ones are still to
 * lose, plus what opening ones are still to gain. Only outermost marks count, since a moving
 * section's own content moves with it. A mark's margins count in full, which holds while a margin
 * collapses only with a neighbor's of the opposite sign: margins of opposite signs add.
 */
export function settledHeight(container: HTMLElement, height: number): number {
  let change = 0
  for (const element of container.querySelectorAll<HTMLElement>(`[${SETTLES_TO}]`)) {
    if (element.parentElement?.closest(`[${SETTLES_TO}]`)) continue
    const mark = element.getAttribute(SETTLES_TO)!
    const marginBox = element.getBoundingClientRect().height + margins(element)
    const settled = target(element, mark)
    change += mark === SETTLES_OPEN ? Math.max(0, settled - marginBox) : -Math.max(0, marginBox - settled)
  }
  return height + change
}

