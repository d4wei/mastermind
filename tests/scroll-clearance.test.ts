// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { scrollElementToTop } from '../ui/util/scroll'

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
