import { vi } from 'vitest'

/** Where a stubbed document lays out its anchors and cards, in pixels from the top of its content. */
export interface DocumentLayout {
  /** The document scroller's visible height; read on every measurement, so a test may change it. */
  viewport: number
  anchorTop: (anchor: HTMLElement) => number
  /** A rail card's border-box height. */
  cardHeight: (card: HTMLElement) => number
}

/**
 * Lays out jsdom as a document scroller would, for the rail's placement and window: the scroller
 * sits at the top of the viewport, the rail and article start at the top of its content, a card sits
 * at its written `top`, the scroller's content is as tall as the rail, and `scrollTo` moves the scroller and dispatches its scroll event. Every
 * other element measures empty. Returns the restore for `scrollTo`; the other spies end
 * with `vi.restoreAllMocks`.
 */
export function stubDocumentLayout(layout: DocumentLayout): () => void {
  const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height,
    x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('document-scroll')) return rect(0, layout.viewport)
    const scrolled = this.closest<HTMLElement>('.document-scroll')?.scrollTop ?? 0
    const card = this.closest<HTMLElement>('.rail-card')
    if (card) {
      const top = (parseFloat(card.style.top) || 0) - scrolled
      return rect(top, this === card ? layout.cardHeight(card) : Math.min(20, layout.cardHeight(card)))
    }
    if (this.classList.contains('rail')) return rect(-scrolled, 0)
    if (this.matches('article [data-span-index]')) return rect(layout.anchorTop(this) - scrolled, 20)
    return rect(0, 0)
  })
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('document-scroll') ? layout.viewport : 0
  })
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
    if (!this.classList.contains('document-scroll')) return 0
    return Math.max(layout.viewport, parseFloat(this.querySelector<HTMLElement>('.rail')?.style.height ?? '') || 0)
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value(this: HTMLElement, x: number | ScrollToOptions, y?: number) {
    this.scrollTop = typeof x === 'number' ? y ?? 0 : x.top ?? this.scrollTop
    this.dispatchEvent(new Event('scroll'))
  } })
  return () => { Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo') }
}

/** Scrolls `scroller` to `top` and lets the rail's frame-throttled window follow. */
export async function scrollDocument(scroller: HTMLElement, top: number): Promise<void> {
  scroller.scrollTo(0, top)
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await new Promise((resolve) => requestAnimationFrame(resolve))
}
