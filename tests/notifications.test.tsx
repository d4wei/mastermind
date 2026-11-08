// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { announce, Notice, Notification, Notifications, NOTICE_DISMISS_FALLBACK_MS, useAnnouncements } from '../ui/app/Notifications'

vi.mock('../ui/i18n', () => ({ useT: () => (key: string) => key }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Reduced motion removes an expired notice without its exit animation.
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useAnnouncements.setState({ items: [] })
  document.documentElement.removeAttribute('style')
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const dismiss = () => act(() => host.querySelector<HTMLButtonElement>('[aria-label="dismiss"]')!.click())
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const shown = () => Array.from(host.querySelectorAll('.notification-stack .notification'), (notice) => notice.textContent)

it('expires a transient notice on its own, without a close control', () => {
  act(() => root.render(<Notifications><Notice tier="transient">Translation unavailable</Notice></Notifications>))
  const notice = host.querySelector('.notification-transient')!
  expect(notice.getAttribute('role')).toBe('status')
  expect(notice.querySelector('button, svg')).toBeNull()
  advance(NOTICE_DISMISS_FALLBACK_MS - 1)
  expect(shown()).toEqual(['Translation unavailable'])
  advance(1)
  expect(shown()).toEqual([])
})

it('reads the transient lifetime from the --notice-dismiss token', () => {
  document.documentElement.setAttribute('style', '--notice-dismiss: 2s')
  act(() => root.render(<Notifications><Notice tier="transient">Short</Notice></Notifications>))
  advance(2000)
  expect(shown()).toEqual([])
})

it('pauses a transient notice while it is hovered or focused, then grants the remaining time', () => {
  act(() => root.render(<Notifications><Notice tier="transient">Translation unavailable</Notice></Notifications>))
  const notice = host.querySelector<HTMLElement>('.notification-transient')!
  advance(1000)
  act(() => { notice.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })) })
  advance(NOTICE_DISMISS_FALLBACK_MS * 2)
  expect(shown()).toEqual(['Translation unavailable'])
  act(() => { notice.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })) })
  advance(NOTICE_DISMISS_FALLBACK_MS - 1001)
  expect(shown()).toEqual(['Translation unavailable'])
  act(() => { notice.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
  advance(NOTICE_DISMISS_FALLBACK_MS)
  expect(shown()).toEqual(['Translation unavailable'])
  act(() => { notice.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  advance(1)
  expect(shown()).toEqual([])
})

it('plays the exit before removing a transient notice when motion is allowed', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  act(() => root.render(<Notifications><Notice tier="transient">Leaving</Notice></Notifications>))
  advance(NOTICE_DISMISS_FALLBACK_MS)
  expect(host.querySelector('.notification-transient.leaving')).not.toBeNull()
  advance(1000)
  expect(shown()).toEqual([])
})

it('never takes focus when a transient notice appears', () => {
  const field = document.createElement('input')
  document.body.append(field)
  field.focus()
  act(() => announce('trim', 'Selection trimmed.'))
  act(() => root.render(<Notifications>{null}</Notifications>))
  expect(document.activeElement).toBe(field)
  field.remove()
})

it('keeps a persistent notice until it is dismissed, then a recall control reopens it', () => {
  act(() => root.render(<Notifications>
    <Notice tier="persistent">Settings could not be saved</Notice>
  </Notifications>))
  const notice = host.querySelector('.notification-persistent')!
  expect(notice.getAttribute('role')).toBe('alert')
  expect(notice.querySelector('svg.notification-icon')).not.toBeNull()
  advance(NOTICE_DISMISS_FALLBACK_MS * 10)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Settings could not be saved')
  dismiss()
  expect(host.querySelector('[role="alert"]')).toBeNull()
  const warning = host.querySelector<HTMLButtonElement>('[aria-label="showNotification"]')!
  expect(warning.closest('.notification-recall')).not.toBeNull()
  expect(warning.textContent).toBe('')
  act(() => warning.click())
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Settings could not be saved')
})

it('offers no close control on a persistent notice that only resolving can clear', () => {
  act(() => root.render(<Notifications><Notification tier="persistent">Read-only file</Notification></Notifications>))
  expect(host.querySelector('.notification-dismiss')).toBeNull()
  advance(NOTICE_DISMISS_FALLBACK_MS * 10)
  expect(shown()).toEqual(['Read-only file'])
})

it('replaces an announcement with the same id in place and restarts its lifetime', () => {
  act(() => root.render(<Notifications>{null}</Notifications>))
  act(() => announce('trim', 'First trim.'))
  advance(NOTICE_DISMISS_FALLBACK_MS - 1000)
  act(() => announce('trim', 'Second trim.'))
  expect(shown()).toEqual(['Second trim.'])
  advance(NOTICE_DISMISS_FALLBACK_MS - 1)
  expect(shown()).toEqual(['Second trim.'])
  act(() => announce('other', 'Another notice.'))
  expect(shown()).toEqual(['Second trim.', 'Another notice.'])
  advance(1)
  expect(shown()).toEqual(['Another notice.'])
})

it('shows a later transient notice after the expired occurrence has cleared', () => {
  const notice = <Notifications><Notice tier="transient">Translation unavailable</Notice></Notifications>
  act(() => root.render(notice))
  advance(NOTICE_DISMISS_FALLBACK_MS)
  act(() => root.render(<Notifications>{null}</Notifications>))
  act(() => root.render(notice))
  expect(shown()).toEqual(['Translation unavailable'])
})
