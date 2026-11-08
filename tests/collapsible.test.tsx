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
/** The row's own transition ending, as the browser reports it. */
function endTransition(propertyName = 'grid-template-rows') {
  const event = new Event('transitionend')
  Object.defineProperty(event, 'propertyName', { value: propertyName })
  act(() => section()!.dispatchEvent(event))
}

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

it('keeps closing content mounted, inert and hidden, until the collapse finishes', () => {
  show(true)
  const input = field()!
  show(false)
  expect(field()).toBe(input)
  expect(section()!.className).toBe('collapsible')
  expect(section()!.hasAttribute('inert')).toBe(true)
  expect(section()!.getAttribute('aria-hidden')).toBe('true')
  expect(section()!.getAttribute('data-settles-to')).toBe('0')
  act(() => vi.advanceTimersByTime(179))
  expect(field()).toBe(input)
  act(() => vi.advanceTimersByTime(1))
  expect(section()).toBeNull()
})

it('reopens the same content when opened again mid-collapse', () => {
  show(true)
  const input = field()!
  show(false)
  act(() => vi.advanceTimersByTime(90))
  show(true)
  expect(field()).toBe(input)
  expect(section()!.className).toBe('collapsible open')
  expect(section()!.hasAttribute('inert')).toBe(false)
  act(() => vi.advanceTimersByTime(500))
  expect(field()).toBe(input)
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
