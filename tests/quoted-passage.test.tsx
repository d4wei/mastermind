// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('easing between clamps', () => {
  /** Each clamp's height: fifteen pixels a line, up to the passage's full 120. */
  const drawnHeight = (element: HTMLElement) => element.classList.contains('expanded') ? 120
    : Math.min(120, 15 * Number(element.style.getPropertyValue('--quote-lines')))
  let animations: { keyframes: Keyframe[]; cancel: ReturnType<typeof vi.fn>; finish: () => void }[]
  let reduced: boolean
  beforeEach(() => {
    animations = []
    reduced = false
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
    document.documentElement.style.setProperty('--dur-base', '180ms')
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains('rail-card-anchor') ? drawnHeight(this) : 0 } as DOMRect
    })
    HTMLElement.prototype.animate = vi.fn((keyframes: Keyframe[]) => {
      let finish = () => {}
      const finished = new Promise<void>((resolve) => { finish = resolve })
      const animation = { keyframes, cancel: vi.fn(), finish, finished }
      animations.push(animation)
      return animation as unknown as Animation
    }) as unknown as HTMLElement['animate']
  })
  afterEach(() => {
    document.documentElement.style.removeProperty('--dur-base')
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    vi.restoreAllMocks()
  })

  it('draws a growing clamp at once and eases its height open from the height on screen', () => {
    size.scroll = 120; size.client = 30
    act(() => root.render(<QuotedPassage text="A long passage" lines={2} expandable={false} />))
    act(() => root.render(<QuotedPassage text="A long passage" lines={6} expandable />))
    expect(quote().style.getPropertyValue('--quote-lines')).toBe('6')
    expect(quote().hasAttribute('data-settles-to')).toBe(false)
    expect(animations.map((animation) => animation.keyframes)).toEqual([[{ maxHeight: '30px' }, { maxHeight: '90px' }]])
  })

  it('keeps a shrinking clamp drawn until its height has eased closed', async () => {
    size.scroll = 120; size.client = 90
    act(() => root.render(<QuotedPassage text="A long passage" lines={6} expandable />))
    act(() => toggle()!.click())
    expect(quote().classList.contains('expanded')).toBe(true)
    act(() => toggle()!.click())
    const closing = animations.at(-1)!
    expect(closing.keyframes).toEqual([{ maxHeight: '120px' }, { maxHeight: '90px' }])
    expect(quote().classList.contains('expanded')).toBe(true)
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
    expect(quote().getAttribute('data-settles-to')).toBe('90')
    await act(async () => closing.finish())
    expect(quote().classList.contains('expanded')).toBe(false)
    expect(quote().hasAttribute('data-settles-to')).toBe(false)
    expect(closing.cancel).toHaveBeenCalled()
  })

  it('changes the clamp at once under reduced motion', () => {
    reduced = true
    size.scroll = 120; size.client = 90
    act(() => root.render(<QuotedPassage text="A long passage" lines={6} expandable />))
    act(() => toggle()!.click())
    act(() => toggle()!.click())
    expect(quote().classList.contains('expanded')).toBe(false)
    expect(animations).toEqual([])
  })
})
