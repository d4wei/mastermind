// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { easeHeightChanges } from '../ui/util/height-transition'

let height = 100
let resized: (() => void) | null = null
let element: HTMLElement
let detach: () => void
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback } observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  document.documentElement.style.setProperty('--dur-base', '180ms')
  // The element reports its explicit height while one is set, and its content's height otherwise.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true,
    get(this: HTMLElement) { return this.style.height ? parseFloat(this.style.height) : height } })
  height = 100
  element = document.createElement('div')
  element.className = 'rail-card'
  document.body.append(element)
  detach = easeHeightChanges(element)
})
afterEach(() => {
  detach()
  element.remove()
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
  document.documentElement.removeAttribute('style')
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Grows the content structurally, as a reply field appearing does, and lets the observers run. */
async function grow(to: number): Promise<void> {
  element.append(document.createElement('textarea'))
  await Promise.resolve()
  height = to
  resized!()
}

it('eases a structural height change from the old height to the new one, then releases it', async () => {
  await grow(180)
  expect(element.style.height).toBe('180px')
  expect(element.style.overflow).toBe('hidden')
  expect(element.style.transition).toContain('height var(--dur-base) var(--ease-standard)')
  element.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'height' }))
  expect(element.style.height).toBe('')
  expect(element.style.overflow).toBe('')
  expect(element.style.transition).toBe('')
})

it('settles on its own when the browser skips the transition', async () => {
  await grow(180)
  vi.advanceTimersByTime(230)
  expect(element.style.height).toBe('')
})

it('keeps a size change without a structural cause immediate, such as a field resized by hand', () => {
  height = 160
  resized!()
  expect(element.style.height).toBe('')
})

it('keeps every change immediate under reduced motion', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  await grow(180)
  expect(element.style.height).toBe('')
})

it('leaves nothing behind when detached mid-animation', async () => {
  await grow(180)
  detach()
  expect(element.style.height).toBe('')
  detach = () => {}
})
