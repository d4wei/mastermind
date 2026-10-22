// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { scrollToOffset, scrollToSpan } from '../ui/util/scroll'

// Both entry points resolve their target through the document, so tag the element and go through them.
function scrollElementToTop(element: Element): void {
  element.setAttribute('data-ps', '0')
  scrollToOffset({ current: document.body }, 0)
}
function scrollToElement(element: Element): void {
  element.setAttribute('data-span-index', '0')
  scrollToSpan({ current: document.body }, 0)
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([0, 60, 120])('keeps outline targets below %ipx of document controls', (height) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(4000)
  const heading = document.createElement('h2')
  document.body.append(heading)
  vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ top: 600 } as DOMRect)
  if (height) {
    const header = document.createElement('header')
    header.className = 'topbar'
    document.body.append(header)
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ bottom: height } as DOMRect)
  }
  scrollElementToTop(heading)
  expect(scrollTo).toHaveBeenCalledWith(0, 600 - height - 24)
})

it('scrolls the bounded document viewport without moving the window', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const viewport = document.createElement('div')
  viewport.className = 'document-scroll'
  viewport.scrollTop = 300
  Object.defineProperties(viewport, { clientHeight: { value: 700 }, scrollHeight: { value: 3000 } })
  viewport.getBoundingClientRect = () => ({ top: 46 }) as DOMRect
  viewport.scrollTo = vi.fn()
  const heading = document.createElement('h2')
  heading.getBoundingClientRect = () => ({ top: 500, height: 40 }) as DOMRect
  viewport.append(heading)
  document.body.append(viewport)
  scrollElementToTop(heading)
  expect(viewport.scrollTo).toHaveBeenLastCalledWith(0, 730)
  scrollToElement(heading)
  expect(viewport.scrollTo).toHaveBeenLastCalledWith(0, 424)
  expect(pageScroll).not.toHaveBeenCalled()
})

it('clamps review navigation at the container bounds', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const viewport = document.createElement('div')
  viewport.className = 'document-scroll'
  Object.defineProperties(viewport, { clientHeight: { value: 700 }, scrollHeight: { value: 1000 } })
  viewport.scrollTo = vi.fn()
  const heading = document.createElement('h2')
  viewport.append(heading)
  document.body.append(viewport)
  heading.getBoundingClientRect = () => ({ top: 2000 }) as DOMRect
  scrollElementToTop(heading)
  expect(viewport.scrollTo).toHaveBeenLastCalledWith(0, 300)
  heading.getBoundingClientRect = () => ({ top: -100 }) as DOMRect
  scrollElementToTop(heading)
  expect(viewport.scrollTo).toHaveBeenLastCalledWith(0, 0)
})

it('leaves visible review targets still and reveals only an offscreen edge', async () => {
  const { revealElement } = await import('../ui/util/scroll')
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const viewport = document.createElement('div')
  viewport.className = 'document-scroll'
  viewport.scrollTop = 500
  Object.defineProperties(viewport, { clientHeight: { value: 600 }, scrollHeight: { value: 3000 } })
  viewport.getBoundingClientRect = () => ({ top: 50 }) as DOMRect
  viewport.scrollTo = vi.fn()
  const card = document.createElement('div')
  viewport.append(card)
  document.body.append(viewport)
  card.getBoundingClientRect = () => ({ top: 100, bottom: 900 }) as DOMRect
  revealElement(card, true)
  expect(viewport.scrollTo).not.toHaveBeenCalled()
  card.getBoundingClientRect = () => ({ top: 700, bottom: 900 }) as DOMRect
  revealElement(card, true)
  expect(viewport.scrollTo).toHaveBeenLastCalledWith(0, 598)
  card.getBoundingClientRect = () => ({ top: 20, bottom: 200 }) as DOMRect
  revealElement(card, true)
  expect(viewport.scrollTo).toHaveBeenLastCalledWith(0, 470)
})
