// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Collapsible } from '../ui/review/Collapsible'
import { createReactHost, removeReactHost } from './helpers/dom'
import type { Root } from 'react-dom/client'

let host: HTMLDivElement
let root: Root
let reduced = false
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  document.documentElement.style.setProperty('--dur-base', '180ms')
  reduced = false
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  document.documentElement.style.removeProperty('--dur-base')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const section = () => host.querySelector<HTMLElement>('.collapsible')
const field = () => host.querySelector('textarea')
const show = (open: boolean) => act(() => root.render(<Collapsible open={open} id="reply"><textarea /></Collapsible>))
/** The row's own transition ending or cancelled, as the browser reports it. */
function endTransition(propertyName = 'grid-template-rows', type = 'transitionend') {
  const event = new Event(type)
  Object.defineProperty(event, 'propertyName', { value: propertyName })
  act(() => section()!.dispatchEvent(event))
}
/** Lists the row's running transitions, which jsdom cannot. */
function stubAnimations(running: () => boolean) {
  HTMLElement.prototype.getAnimations = () => running()
    ? [{ transitionProperty: 'grid-template-rows', playState: 'running' } as unknown as Animation] : []
}
afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations') })

it('renders content opened with it at once, and nothing while closed', () => {
  show(true)
  expect(section()!.className).toBe('collapsible open settled')
  expect(section()!.id).toBe('reply')
  expect(section()!.hasAttribute('inert')).toBe(false)
  expect(section()!.hasAttribute('data-settles-to')).toBe(false)
  expect(field()).not.toBeNull()
  act(() => root.unmount())
  ;({ host, root } = createReactHost())
  show(false)
  expect(section()).toBeNull()
})

it('opens through its row transition and stops clipping only when that transition ends', () => {
  show(false)
  show(true)
  expect(section()!.className).toBe('collapsible open')
  expect(field()).not.toBeNull()
  endTransition('margin-top')
  expect(section()!.className).toBe('collapsible open')
  endTransition()
  expect(section()!.className).toBe('collapsible open settled')
})

it('settles an opening row whose transition is cancelled', () => {
  show(false)
  show(true)
  endTransition('grid-template-rows', 'transitioncancel')
  expect(section()!.className).toBe('collapsible open settled')
})

it('keeps clipping through a cancel that reverses the row mid-way', () => {
  let moving = true
  stubAnimations(() => moving)
  show(false)
  show(true)
  endTransition('grid-template-rows', 'transitioncancel')
  expect(section()!.className).toBe('collapsible open')
  moving = false
  endTransition()
  expect(section()!.className).toBe('collapsible open settled')
})

it('keeps closing content mounted, inert and hidden, until the row\'s transition ends', () => {
  show(true)
  const input = field()!
  show(false)
  expect(field()).toBe(input)
  expect(section()!.className).toBe('collapsible')
  expect(section()!.hasAttribute('inert')).toBe(true)
  expect(section()!.getAttribute('aria-hidden')).toBe('true')
  expect(section()!.getAttribute('data-settles-to')).toBe('0')
  act(() => vi.advanceTimersByTime(1000))
  expect(field()).toBe(input)
  endTransition('margin-top')
  expect(field()).toBe(input)
  endTransition()
  expect(section()).toBeNull()
})

it('unmounts closing content whose transition is cancelled', () => {
  show(true)
  show(false)
  endTransition('grid-template-rows', 'transitioncancel')
  expect(section()).toBeNull()
})

it('unmounts closing content at once when the row does not transition', () => {
  stubAnimations(() => false)
  show(true)
  show(false)
  expect(section()).toBeNull()
})

it('draws closing content from its last open render and refuses its input', () => {
  const post = vi.fn()
  const draw = (open: boolean, label: string) => act(() => root.render(<Collapsible open={open}>
    <button type="button" onClick={post} onKeyDown={post}>{label}</button>
  </Collapsible>))
  draw(true, 'Reply')
  draw(false, 'Changed')
  const button = host.querySelector('button')!
  expect(button.textContent).toBe('Reply')
  act(() => {
    button.click()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  expect(post).not.toHaveBeenCalled()
  draw(true, 'Again')
  expect(host.querySelector('button')).toBe(button)
  expect(button.textContent).toBe('Again')
  act(() => button.click())
  expect(post).toHaveBeenCalledTimes(1)
})

it('reopens the same content when opened again mid-collapse', () => {
  show(true)
  const input = field()!
  show(false)
  show(true)
  expect(field()).toBe(input)
  expect(section()!.className).toBe('collapsible open')
  expect(section()!.hasAttribute('inert')).toBe(false)
  endTransition()
  expect(field()).toBe(input)
  expect(section()!.className).toBe('collapsible open settled')
})

it('changes at once under reduced motion', () => {
  reduced = true
  show(false)
  show(true)
  expect(section()!.className).toBe('collapsible open settled')
  show(false)
  expect(section()).toBeNull()
})

it('changes at once when the duration token is unset', () => {
  document.documentElement.style.removeProperty('--dur-base')
  show(true)
  show(false)
  expect(section()).toBeNull()
  show(true)
  expect(section()!.className).toBe('collapsible open settled')
})
