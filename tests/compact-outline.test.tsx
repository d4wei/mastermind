// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Navigator } from '../ui/app/Navigator'
import { useNav } from '../ui/app/navStore'
import { extractOutline } from '../ui/modes/reading/outline'
import { parseMarkdown } from '../document/markdown/processor'

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

it('keeps all heading depths and moves the active indicator in both outlines', () => {
  const source = Array.from({ length: 6 }, (_, index) =>
    `${'#'.repeat(index + 1)} Level ${index + 1}\n\nSection text.\n\n`).join('')
  useNav.setState({ outline: extractOutline(parseMarkdown(source)), docEl: null })
  act(() => root.render(<Navigator />))
  const ticks = Array.from(host.querySelectorAll<HTMLElement>('.outline-tick'))
  expect(ticks.map((tick) => tick.style.getPropertyValue('--heading-depth'))).toEqual(['0', '1', '2', '3', '4', '5'])
  act(() => host.querySelector<HTMLButtonElement>('.outline-progress')!.click())
  const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.nav-outline button'))
  expect(buttons.map((button) => button.style.cssText)).toEqual(ticks.map((tick) => tick.style.cssText))
  expect(buttons[0]!.getAttribute('aria-current')).toBe('location')
  expect(buttons.map((button) => button.querySelector('.outline-label')?.textContent))
    .toEqual(['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6'])
  act(() => buttons[5]!.click())
  expect(host.querySelector<HTMLElement>('.outline-tick.active')!.style.getPropertyValue('--heading-depth')).toBe('5')
  act(() => host.querySelector<HTMLButtonElement>('.outline-progress')!.click())
  expect(host.querySelector('.nav-outline button[aria-current]')?.textContent).toBe('Level 6')
  expect(host.querySelectorAll('.nav-outline button[aria-current]')).toHaveLength(1)
})
