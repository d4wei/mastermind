import type { RefObject } from 'react'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// All review modes scroll the page. A shared animation keeps review and outline navigation
// consistent and lets a new navigation cancel the previous one.
let scrollRaf = 0
function smoothScrollWindowTo(top: number): void {
  if (scrollRaf) {
    cancelAnimationFrame(scrollRaf)
    scrollRaf = 0
  }
  const max = document.documentElement.scrollHeight - window.innerHeight
  const dest = Math.max(0, Math.min(top, max))
  const start = window.scrollY
  const dist = dest - start
  // Instant when there's nothing to animate, reduced-motion is set, or the tab
  // is hidden (rAF is paused while hidden, so an animation would never run).
  if (prefersReducedMotion() || document.hidden || Math.abs(dist) < 2) {
    window.scrollTo(0, dest)
    return
  }
  const duration = Math.min(480, Math.max(180, Math.abs(dist) * 0.5))
  let t0 = 0
  const step = (ts: number): void => {
    if (!t0) t0 = ts
    const p = Math.min(1, (ts - t0) / duration)
    const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2 // easeInOutQuad
    window.scrollTo(0, start + dist * eased)
    scrollRaf = p < 1 ? requestAnimationFrame(step) : 0
  }
  scrollRaf = requestAnimationFrame(step)
}

/** Scroll a matched element to the viewport center (review navigation). Returns it. */
export function scrollToElement(el: Element | null): Element | null {
  if (el) {
    const rect = el.getBoundingClientRect()
    smoothScrollWindowTo(window.scrollY + rect.top - (window.innerHeight - rect.height) / 2)
  }
  return el
}

/** Align a viewport position with the outline's reading line below the controls. */
export function scrollPositionToTop(top: number, offsetTop = 24): void {
  const controlsBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
  smoothScrollWindowTo(window.scrollY + top - offsetTop - controlsBottom)
}

export function scrollElementToTop(el: Element | null, offsetTop = 24): Element | null {
  if (el) scrollPositionToTop(el.getBoundingClientRect().top, offsetTop)
  return el
}

/** Scroll to the rendered element for a scanner span index. */
export function scrollToSpan(doc: RefObject<HTMLElement | null>, spanIndex: number): Element | null {
  return scrollToElement(doc.current?.querySelector(`[data-span-index="${spanIndex}"]`) ?? null)
}

/** Scroll to the rendered element whose source offset matches (outline headings). */
export function scrollToOffset(doc: RefObject<HTMLElement | null>, offset: number): Element | null {
  return scrollElementToTop(doc.current?.querySelector(`[data-ps="${offset}"]`) ?? null)
}
