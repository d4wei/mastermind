import type { RefObject } from 'react'

export function documentViewport() {
  const element = document.querySelector<HTMLElement>('.document-scroll')
  const top = element?.getBoundingClientRect().top ?? 0
  const height = element?.clientHeight ?? window.innerHeight
  const scrollTop = element?.scrollTop ?? window.scrollY
  const scrollHeight = element?.scrollHeight ?? document.documentElement.scrollHeight
  return { element, target: element ?? window, top, height, scrollTop,
    maxScroll: Math.max(0, scrollHeight - height) }
}

export function readingLine(): number {
  return Math.max(documentViewport().top,
    document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0)
}

let scrollRaf = 0
function smoothScrollTo(top: number): void {
  if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0 }
  const viewport = documentViewport()
  const dest = Math.max(0, Math.min(top, viewport.maxScroll))
  const start = viewport.scrollTop
  const dist = dest - start
  const move = (y: number): void => {
    if (viewport.element) viewport.element.scrollTo(0, y)
    else window.scrollTo(0, y)
  }
  // Hidden pages cannot complete an animation while their frame callbacks are paused.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden || Math.abs(dist) < 2) {
    move(dest)
    return
  }
  const duration = Math.min(480, Math.max(180, Math.abs(dist) * 0.5))
  let t0 = 0
  const step = (ts: number): void => {
    if (viewport.element && !viewport.element.isConnected) { scrollRaf = 0; return }
    if (!t0) t0 = ts
    const p = Math.min(1, (ts - t0) / duration)
    const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2
    move(start + dist * eased)
    scrollRaf = p < 1 ? requestAnimationFrame(step) : 0
  }
  scrollRaf = requestAnimationFrame(step)
}

export function scrollToElement(el: Element | null): Element | null {
  if (el) {
    const rect = el.getBoundingClientRect()
    const viewport = documentViewport()
    smoothScrollTo(viewport.scrollTop + rect.top - viewport.top - (viewport.height - rect.height) / 2)
  }
  return el
}

/** Align viewport coordinates with the document's reading line. */
export function scrollPositionToTop(top: number, offsetTop = 24): void {
  smoothScrollTo(documentViewport().scrollTop + top - offsetTop - readingLine())
}

export function scrollElementToTop(el: Element | null, offsetTop = 24): Element | null {
  if (el) scrollPositionToTop(el.getBoundingClientRect().top, offsetTop)
  return el
}

export function scrollToSpan(doc: RefObject<HTMLElement | null>, spanIndex: number): Element | null {
  let target = doc.current?.querySelector(`[data-span-index="${spanIndex}"]`) ?? null
  const commentTarget = target?.getAttribute('data-comment-target')
  if (commentTarget != null) {
    target = doc.current?.querySelector(`[data-span-index="${commentTarget}"]`) ?? target
  }
  return scrollToElement(target)
}

export function scrollToOffset(doc: RefObject<HTMLElement | null>, offset: number): Element | null {
  return scrollElementToTop(doc.current?.querySelector(`[data-ps="${offset}"]`) ?? null)
}

/** Reveal only the missing edge; already-visible targets must not move the reading position. */
export function revealRange(top: number, bottom: number): void {
  const viewport = documentViewport()
  const visibleTop = readingLine()
  const visibleBottom = viewport.top + viewport.height
  if (top < visibleTop) smoothScrollTo(viewport.scrollTop + top - visibleTop)
  else if (bottom > visibleBottom) smoothScrollTo(viewport.scrollTop + bottom - visibleBottom)
}

export function revealElement(element: Element | null, headerOnly = false): void {
  if (!element) return
  const rect = element.getBoundingClientRect()
  revealRange(rect.top, headerOnly ? Math.min(rect.bottom, rect.top + 48) : rect.bottom)
}
