// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Navigator, tickWindowShift, type NavigatorProps } from '../ui/app/Navigator'
import { extractOutline } from '../ui/modes/reading/outline'
import { parseMarkdown } from '../document/markdown/processor'

let host: HTMLDivElement
let root: Root
let props: NavigatorProps
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  props = { outline: [{ depth: 1, text: 'First', offset: 0 }, { depth: 2, text: 'Second', offset: 12 }], docEl: null, source: null }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('opens on keyboard focus and dismisses with Escape without reopening', () => {
  act(() => root.render(<Navigator {...props} />))
  const trigger = host.querySelector<HTMLButtonElement>('.outline-progress')!
  expect(host.querySelector('.nav-outline')).toBeNull()
  act(() => trigger.focus())
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  act(() => host.querySelector<HTMLButtonElement>('.nav-outline button')!.focus())
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(document.activeElement).toBe(trigger)
  expect(host.querySelector('.nav-outline')).toBeNull()
})
it('navigates on every mouse selection when the trigger retains focus between openings', () => {
  const navigate = vi.fn()
  props.source = { headingTop: () => 0, scrollTo: navigate }
  act(() => root.render(<Navigator {...props} />))
  const nav = host.querySelector('nav')!
  const trigger = host.querySelector<HTMLButtonElement>('.outline-progress')!
  for (let index = 0; index < 4; index++) {
    act(() => nav.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
    const heading = host.querySelectorAll<HTMLButtonElement>('.nav-outline button')[index % 2]!
    act(() => {
      const defaultsAllowed = heading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      // WebKit mouse presses blur the previous control without focusing the clicked button.
      if (defaultsAllowed && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    act(() => { if (heading.isConnected) heading.click() })
    expect(navigate).toHaveBeenCalledTimes(index + 1)
    expect(navigate).toHaveBeenLastCalledWith(index % 2 === 0 ? 0 : 12)
    expect(document.activeElement).toBe(trigger)
    expect(host.querySelector('.nav-outline')).toBeNull()
  }
})
it('keeps keyboard heading activation and dismissal on focus leaving the outline', () => {
  const navigate = vi.fn()
  props.source = { headingTop: () => 0, scrollTo: navigate }
  act(() => root.render(<Navigator {...props} />))
  const trigger = host.querySelector<HTMLButtonElement>('.outline-progress')!
  act(() => trigger.focus())
  const heading = host.querySelectorAll<HTMLButtonElement>('.nav-outline button')[1]!
  act(() => heading.focus())
  act(() => heading.click())
  expect(navigate).toHaveBeenCalledWith(12)
  expect(document.activeElement).toBe(trigger)
  act(() => trigger.click())
  const outside = document.createElement('button')
  host.append(outside)
  act(() => outside.focus())
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
  props.docEl = article
  act(() => root.render(<Navigator {...props} />))
  expect(host.querySelector('.outline-progress')?.getAttribute('aria-label')).toContain('First')
  scroll = 600
  act(() => window.dispatchEvent(new Event('scroll')))
  expect(host.querySelector('.outline-progress')?.getAttribute('aria-label')).toContain('Second')
  expect(host.querySelectorAll('.outline-tick.active')).toHaveLength(1)
})

it('keeps all heading depths and moves the active indicator in both outlines', () => {
  const source = Array.from({ length: 6 }, (_, index) =>
    `${'#'.repeat(index + 1)} Level ${index + 1}\n\nSection text.\n\n`).join('')
  props = { outline: extractOutline(parseMarkdown(source)), docEl: null, source: null }
  act(() => root.render(<Navigator {...props} />))
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

it('tracks Markdown headings from editor geometry without rendered heading elements', () => {
  let scroll = 0
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scroll)
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000)
  props.source = { headingTop: (offset) => (offset === 0 ? 100 : 600) - scroll, scrollTo: () => {} }
  act(() => root.render(<Navigator {...props} />))
  expect(host.querySelector('.outline-progress')?.getAttribute('aria-label')).toContain('First')
  scroll = 700
  act(() => window.dispatchEvent(new Event('scroll')))
  expect(host.querySelector('.outline-progress')?.getAttribute('aria-label')).toContain('Second')
  expect(host.querySelectorAll('.outline-tick.active')).toHaveLength(1)
  act(() => root.render(<Navigator {...props} source={null} />))
  act(() => window.dispatchEvent(new Event('scroll')))
})

it('tracks element scrolling while the window stays stationary', () => {
  const viewport = document.createElement('div')
  viewport.className = 'document-scroll'
  viewport.getBoundingClientRect = () => ({ top: 46 }) as DOMRect
  Object.defineProperties(viewport, { clientHeight: { value: 700 }, scrollHeight: { value: 2000 } })
  document.body.append(viewport)
  const article = document.createElement('article')
  article.innerHTML = '<h1 data-ps="0">First</h1><h2 data-ps="12">Second</h2>'
  viewport.append(article)
  article.querySelectorAll('h1,h2').forEach((element, index) => {
    element.getBoundingClientRect = () => ({ top: 46 + index * 500 - viewport.scrollTop }) as DOMRect
  })
  props.docEl = article
  act(() => root.render(<Navigator {...props} />))
  expect(host.querySelector('.outline-progress')?.getAttribute('aria-label')).toContain('First')
  viewport.scrollTop = 600
  act(() => viewport.dispatchEvent(new Event('scroll')))
  expect(host.querySelector('.outline-progress')?.getAttribute('aria-label')).toContain('Second')
  expect(window.scrollY).toBe(0)
  viewport.remove()
})

it('eases outline bar width and color with the shared motion tokens, and not under reduced motion', () => {
  const sheet = postcss.parse(readFileSync('ui/app/app.css', 'utf8'))
  const declared = (selector: string, inReducedMotion: boolean) => {
    const values: string[] = []
    sheet.walkRules((rule) => {
      const reduced = rule.parent?.type === 'atrule' && /prefers-reduced-motion:\s*reduce/.test((rule.parent as postcss.AtRule).params)
      if (reduced !== inReducedMotion || !rule.selectors.includes(selector)) return
      rule.walkDecls('transition', (decl) => { values.push(decl.value) })
    })
    return values
  }
  for (const tick of ['.outline-tick', '.outline-list-tick']) {
    const [transition] = declared(tick, false)
    expect(transition, tick).toMatch(/^width var\(--dur-[a-z]+\) var\(--ease-standard\), background-color var\(--dur-[a-z]+\) var\(--ease-standard\)$/)
    expect(declared(tick, true), tick).toEqual(['none'])
  }
})

const outlineSheet = () => postcss.parse(readFileSync('ui/app/app.css', 'utf8'))
const ruleDecls = (selector: string, reducedMotion = false) => {
  const values: Record<string, string> = {}
  outlineSheet().walkRules((rule) => {
    const reduced = rule.parent?.type === 'atrule' && /prefers-reduced-motion:\s*reduce/.test((rule.parent as postcss.AtRule).params)
    if (reduced !== reducedMotion || !rule.selectors.includes(selector)) return
    rule.walkDecls((decl) => { values[decl.prop] = decl.value.replace(/\s+/g, ' ') })
  })
  return values
}

/** Renders `count` headings a hundred pixels apart, scrollable through window scroll. */
function renderTall(count: number, windowPx: number, { startAt = 0, queueFrames = false } = {}) {
  let scroll = startAt * 100
  // Queued frames run on `flushFrames`; otherwise each frame runs at once and reports itself
  // already run, so successive scroll events each schedule a fresh update.
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    if (queueFrames) return frames.push(callback)
    callback(0)
    return 0
  })
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scroll)
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(count * 100 + 2000)
  const observers: Array<() => void> = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observers.push(callback) }
    observe() {}
    disconnect() {}
  })
  const view = { height: windowPx }
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('outline-window') ? view.height : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('outline-track') ? this.childElementCount * 8 : 0
  })
  const outline = () => Array.from({ length: count }, (_, index) =>
    ({ depth: 1 + (index % 3), text: `Heading ${index}`, offset: index * 10 }))
  props = { outline: outline(), docEl: null, source: { headingTop: (offset) => offset * 10 - scroll, scrollTo: () => {} } }
  act(() => root.render(<Navigator {...props} />))
  const track = host.querySelector<HTMLElement>('.outline-track')!
  return {
    shift: () => Number(track.style.getPropertyValue('--outline-shift')),
    easing: () => track.hasAttribute('data-easing'),
    flushFrames() {
      act(() => { while (frames.length) frames.shift()!(0) })
    },
    replaceHeadings(at: number) {
      scroll = at * 100
      act(() => root.render(<Navigator {...props} outline={outline()} />))
    },
    activeIndex: () => Array.from(host.querySelectorAll('.outline-tick')).findIndex((tick) => tick.classList.contains('active')),
    scrollTo(index: number) {
      scroll = index * 100
      act(() => window.dispatchEvent(new Event('scroll')))
    },
    resize(height: number) {
      view.height = height
      act(() => observers.forEach((callback) => callback()))
    },
  }
}

it('lays ticks out at one fixed row pitch and caps the strip at the bottom bar clearance', () => {
  const progress = ruleDecls('.outline-progress')
  expect(progress['--outline-row']).toBe('calc(var(--space-unit) * 2)')
  expect(progress.height).toBe('min(calc(var(--heading-count) * var(--outline-row) + var(--space-unit) * 4), calc(100vh - var(--outline-top) - var(--bar-gap)))')
  expect(progress.padding).toBe('calc(var(--space-unit) * 2)')
  expect(ruleDecls('.compact-outline').top).toBe('var(--outline-top)')
  expect(ruleDecls('.outline-tick')['margin-block']).toBe('calc((var(--outline-row) - var(--space-unit) * .5) / 2)')
  // The window clips without ever becoming a scroll container.
  expect(ruleDecls('.outline-window').overflow).toBe('hidden')
  const track = ruleDecls('.outline-track')
  expect(track.transform).toBe('translateY(calc(var(--outline-shift) * var(--outline-row) * -1))')
  expect(track.transition).toBeUndefined()
  expect(ruleDecls('.outline-track[data-easing]').transition).toMatch(/^transform var\(--dur-[a-z]+\) var\(--ease-standard\)$/)
  expect(ruleDecls('.outline-track[data-easing]', true).transition).toBe('none')
})

it('keeps a dozen headings in the same strip with an unshifted window', () => {
  const tall = renderTall(12, 12 * 8)
  const progress = host.querySelector<HTMLElement>('.outline-progress')!
  expect(progress.style.getPropertyValue('--heading-count')).toBe('12')
  const ticks = host.querySelectorAll<HTMLElement>('.outline-progress > .outline-window > .outline-track > .outline-tick')
  expect(ticks).toHaveLength(12)
  expect(Array.from(ticks, (tick) => tick.style.getPropertyValue('--heading-depth'))).toEqual(
    Array.from({ length: 12 }, (_, index) => String(index % 3)))
  for (const index of [0, 6, 11]) {
    tall.scrollTo(index)
    expect(tall.activeIndex()).toBe(index)
    expect(tall.shift()).toBe(0)
  }
})

it('rolls the window of 400 headings only when the active tick nears an edge, and refits on resize', () => {
  const tall = renderTall(400, 50 * 8)
  expect(host.querySelector<HTMLElement>('.outline-progress')!.style.getPropertyValue('--heading-count')).toBe('400')
  expect(tall.shift()).toBe(0)
  tall.scrollTo(45)
  expect(tall.activeIndex()).toBe(45)
  expect(tall.shift()).toBe(0)
  tall.scrollTo(46)
  expect(tall.shift()).toBe(1)
  tall.scrollTo(120)
  expect(tall.shift()).toBe(75)
  // Moving back inside the window leaves it still until the top margin is reached.
  tall.scrollTo(100)
  expect(tall.shift()).toBe(75)
  tall.scrollTo(78)
  expect(tall.shift()).toBe(74)
  tall.scrollTo(399)
  expect(tall.shift()).toBe(350)
  tall.resize(20 * 8)
  expect(tall.shift()).toBe(380)
  tall.scrollTo(200)
  expect(tall.shift()).toBe(196)
  tall.resize(10 * 8)
  expect(tall.shift()).toBe(196)
  tall.resize(6 * 8)
  expect(tall.shift()).toBe(197)
})

it('derives the window position from the active row, visible rows, and edge margin', () => {
  expect(tickWindowShift(0, 11, 12, 12)).toBe(0)
  expect(tickWindowShift(3, 11, Infinity, 12)).toBe(0)
  expect(tickWindowShift(0, 46, 50, 400)).toBe(1)
  expect(tickWindowShift(10, 30, 50, 400)).toBe(10)
  expect(tickWindowShift(100, 3, 50, 400)).toBe(0)
  // A partial last row moves the window in whole rows until the end of the outline.
  expect(tickWindowShift(0, 199, 81.75, 400)).toBe(123)
  expect(tickWindowShift(0, 399, 50.5, 400)).toBe(349.5)
  // A window too short for the full margin centers the active row as closely as it can.
  expect(tickWindowShift(0, 10, 3, 400)).toBe(9)
})

it('places a heading set\'s window in place and eases only the moves after it paints', () => {
  const tall = renderTall(400, 50 * 8, { startAt: 200, queueFrames: true })
  expect(tall.shift()).toBe(155)
  expect(tall.easing()).toBe(false)
  tall.flushFrames()
  expect(tall.easing()).toBe(true)
  // A replaced set keeps the window where it can, moving it only as far as the active tick needs.
  tall.replaceHeadings(20)
  expect(tall.shift()).toBe(16)
  expect(tall.easing()).toBe(false)
  tall.flushFrames()
  expect(tall.easing()).toBe(true)
})
