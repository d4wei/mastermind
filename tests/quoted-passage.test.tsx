// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QuotedPassage } from '../ui/review/QuotedPassage'

vi.mock('../ui/i18n', () => ({ useT: () => (key: string) => key }))

let host: HTMLDivElement
let root: Root
/** The rendered height of the quote's text against the height its clamp leaves visible. */
const size = { scroll: 0, client: 0 }
let resize: (() => void) | null = null
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => size.scroll })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => size.client })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  vi.unstubAllGlobals()
})

const quote = () => host.querySelector<HTMLElement>('.rail-card-anchor')!
const toggle = () => host.querySelector<HTMLButtonElement>('.rail-quote-footer button')

it('clamps to its line count, keeps the full text in the title, and offers no toggle when it fits', () => {
  size.scroll = 30; size.client = 30
  act(() => root.render(<QuotedPassage text="A short passage" lines={6} expandable />))
  expect(quote().style.getPropertyValue('--quote-lines')).toBe('6')
  expect(quote().title).toBe('A short passage')
  expect(quote().textContent).toBe('A short passage')
  expect(toggle()).toBeNull()
})

it('offers no toggle on an unselected card, however long its passage', () => {
  size.scroll = 120; size.client = 30
  act(() => root.render(<QuotedPassage text="A long passage" lines={2} expandable={false} />))
  expect(quote().style.getPropertyValue('--quote-lines')).toBe('2')
  expect(toggle()).toBeNull()
})

it('reveals an overflowing passage whole through the shared chevron disclosure, and clamps it again', () => {
  size.scroll = 120; size.client = 30
  act(() => root.render(<QuotedPassage text="A long passage" lines={6} expandable />))
  expect(toggle()!.className).toBe('rail-link rail-disclosure rail-disclosure-expand')
  expect(toggle()!.textContent).toBe('quoteShowMore')
  expect(toggle()!.querySelector('svg')).not.toBeNull()
  expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
  expect(document.getElementById(toggle()!.getAttribute('aria-controls')!)).toBe(quote())
  act(() => toggle()!.click())
  expect(quote().classList.contains('expanded')).toBe(true)
  expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
  expect(toggle()!.textContent).toBe('quoteShowLess')
  act(() => toggle()!.click())
  expect(quote().classList.contains('expanded')).toBe(false)
  expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
})

it('collapses when its card is deselected and rechecks overflow when resized', () => {
  size.scroll = 120; size.client = 30
  act(() => root.render(<QuotedPassage text="A long passage" lines={6} expandable />))
  act(() => toggle()!.click())
  act(() => root.render(<QuotedPassage text="A long passage" lines={2} expandable={false} />))
  expect(quote().classList.contains('expanded')).toBe(false)
  expect(toggle()).toBeNull()
  size.client = 120
  act(() => root.render(<QuotedPassage text="A long passage" lines={6} expandable />))
  expect(quote().classList.contains('expanded')).toBe(false)
  expect(toggle()).toBeNull()
  size.client = 60
  act(() => resize!())
  expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
})

it('quotes a resolved passage as a labeled blockquote', () => {
  act(() => root.render(<QuotedPassage as="blockquote" text="Archived" lines={6} expandable aria-label="Quoted passage" />))
  expect(quote().tagName).toBe('BLOCKQUOTE')
  expect(quote().getAttribute('aria-label')).toBe('Quoted passage')
})
