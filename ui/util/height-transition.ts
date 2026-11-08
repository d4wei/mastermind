import { cssMs } from './css-tokens'
import { prefersReducedMotion } from './presence'

/**
 * Eases `element`'s height when its content changes structure (children added or removed, or a
 * class or disclosure state toggled), instead of letting it jump. The element animates from its
 * previous height to the new one over `--dur-base`, clipped meanwhile, then returns to its natural
 * height; a change that lands mid-animation follows once it settles. Size changes without a
 * structural cause, such as a text field resized by hand or a wider window, stay immediate, and
 * reduced motion keeps every change immediate. Returns a function that detaches it.
 *
 * Observers of the element's size see the intermediate heights, so a layout measured from them
 * follows the animation frame by frame.
 */
export function easeHeightChanges(element: HTMLElement): () => void {
  // Environments without the observers, such as server rendering, keep every change immediate.
  if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  let settled = element.offsetHeight
  let structural = false
  /** A structural change landed mid-animation; it eases once the animation settles. */
  let deferred = false
  let animating = false
  let target = settled
  let fallback: ReturnType<typeof setTimeout> | null = null
  const finish = (): void => {
    if (!animating) return
    animating = false
    if (fallback !== null) clearTimeout(fallback)
    fallback = null
    element.style.removeProperty('height')
    element.style.removeProperty('overflow')
    element.style.removeProperty('transition')
    // The animated-to height, so content that changed meanwhile eases on from it.
    settled = target
    if (element.offsetHeight === target) deferred = false
  }
  const onEnd = (event: TransitionEvent): void => {
    if (event.target === element && event.propertyName === 'height') finish()
  }
  // A structural change resizes the element in the layout of the frame it lands in; one that
  // resizes nothing, such as a hover class, must not make a later manual resize ease.
  let expiry = 0
  const mutations = new MutationObserver(() => {
    if (animating) { deferred = true; return }
    structural = true
    cancelAnimationFrame(expiry)
    expiry = requestAnimationFrame(() => { expiry = requestAnimationFrame(() => { structural = false }) })
  })
  mutations.observe(element, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'hidden', 'open', 'aria-expanded'] })
  const sizes = new ResizeObserver(() => {
    if (animating) return
    const next = element.offsetHeight
    const from = settled
    const ease = (structural || deferred) && next !== from && !prefersReducedMotion()
    structural = false
    deferred = false
    settled = next
    if (!ease) return
    const style = getComputedStyle(element)
    const duration = cssMs(getComputedStyle(document.documentElement), '--dur-base') ?? 0
    if (duration <= 0) return
    animating = true
    // Size observers run after layout and before paint, so the new height is never shown first.
    element.style.height = `${from}px`
    element.style.overflow = 'hidden'
    void element.offsetHeight
    const existing = style.transition && !style.transition.startsWith('all 0s') ? `${style.transition}, ` : ''
    element.style.transition = `${existing}height var(--dur-base) var(--ease-standard)`
    element.style.height = `${next}px`
    target = next
    // A transition the browser skips, such as on a hidden element, ends no animation.
    fallback = setTimeout(finish, duration + 50)
  })
  sizes.observe(element)
  element.addEventListener('transitionend', onEnd)
  element.addEventListener('transitioncancel', onEnd)
  return () => {
    cancelAnimationFrame(expiry)
    mutations.disconnect()
    sizes.disconnect()
    element.removeEventListener('transitionend', onEnd)
    element.removeEventListener('transitioncancel', onEnd)
    finish()
  }
}
