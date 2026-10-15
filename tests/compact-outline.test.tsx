// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Navigator } from '../ui/app/Navigator'
import { useNav } from '../ui/app/navStore'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  useNav.setState({ outline: [{ depth: 1, text: 'First', offset: 0 }, { depth: 2, text: 'Second', offset: 12 }], docEl: null })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useNav.setState({ outline: [], docEl: null })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('opens on keyboard focus and dismisses with Escape without reopening', () => {
  act(() => root.render(<Navigator />))
  const trigger = host.querySelector<HTMLButtonElement>('.outline-progress')!
  expect(host.querySelector('.nav-outline')).toBeNull()
  act(() => trigger.focus())
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  act(() => host.querySelector<HTMLButtonElement>('.nav-outline button')!.focus())
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(document.activeElement).toBe(trigger)
  expect(host.querySelector('.nav-outline')).toBeNull()
})
it('tracks the active heading as the document scrolls', () => {
  const article = document.createElement('article')
  article.innerHTML = '<h1 data-ps="0">First</h1><h2 data-ps="12">Second</h2>'
  let scroll = 0
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scroll)
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000)
  article.querySelectorAll('h1,h2').forEach((element, index) => {
    element.getBoundingClientRect = () => ({ top: index * 500 - scroll }) as DOMRect
  })
  useNav.setState({ docEl: article })
  act(() => root.render(<Navigator />))
  expect(host.querySelector('.outline-progress')?.getAttribute('aria-label')).toContain('First')
  scroll = 600
  act(() => window.dispatchEvent(new Event('scroll')))
  expect(host.querySelector('.outline-progress')?.getAttribute('aria-label')).toContain('Second')
  expect(host.querySelectorAll('.outline-tick.active')).toHaveLength(1)
})
