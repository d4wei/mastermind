// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Notice, Notifications } from '../ui/app/Notifications'

vi.mock('../ui/i18n', () => ({ useT: () => (key: string) => key }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const dismiss = () => act(() => host.querySelector<HTMLButtonElement>('[aria-label="dismiss"]')!.click())

it('fully dismisses translation information and stays dismissed across rerenders', () => {
  const render = () => act(() => root.render(<Notifications>
    <Notice>Translation unavailable</Notice>
  </Notifications>))
  render()
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Translation unavailable')
  dismiss()
  render()
  expect(host.querySelector('.notification-stack')?.childElementCount).toBe(0)
  expect(host.querySelector('button')).toBeNull()
})

it('shows a later notice after the dismissed occurrence has cleared', () => {
  const notice = <Notifications><Notice>Translation unavailable</Notice></Notifications>
  act(() => root.render(notice))
  dismiss()
  act(() => root.render(<Notifications>{null}</Notifications>))
  act(() => root.render(notice))
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Translation unavailable')
})

it('retains errors as compact warning buttons that reopen the recovery content', () => {
  act(() => root.render(<Notifications>
    <Notice error>Settings could not be saved</Notice>
  </Notifications>))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Settings could not be saved')
  dismiss()
  expect(host.querySelector('[role="alert"]')).toBeNull()
  const warning = host.querySelector<HTMLButtonElement>('[aria-label="showNotification"]')!
  expect(warning.closest('.notification-compact')).not.toBeNull()
  expect(warning.textContent).toBe('')
  act(() => warning.click())
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Settings could not be saved')
})
