// @vitest-environment jsdom
import { act, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SlideOver } from '../ui/app/SlideOver'
import { TopBar } from '../ui/app/TopBar'
import { openReaderMenu, readerMenuItem } from './helpers/reader-menu'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let trigger: HTMLButtonElement
const close = vi.fn()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  host = document.createElement('div')
  trigger = document.createElement('button')
  trigger.className = 'test-trigger'
  document.body.append(trigger, host)
  trigger.focus()
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove(); trigger.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); close.mockClear()
})
function render(composer = false) {
  act(() => root.render(<SlideOver title="Comments" onClose={close} returnFocusSelector=".test-trigger">
    {composer ? <textarea autoFocus /> : <p>Discussion</p>}
  </SlideOver>))
  act(() => vi.advanceTimersByTime(30))
}
it('moves focus inside on open and restores the trigger on close', () => {
  render()
  expect(document.activeElement).toBe(host.querySelector('button'))
  act(() => root.render(null))
  expect(document.activeElement).toBe(trigger)
})
it('keeps a child composer focused and returns to the invoking control when it closes', () => {
  render(true)
  expect(document.activeElement).toBe(host.querySelector('textarea'))
  act(() => root.render(null))
  expect(document.activeElement).toBe(trigger)
})
it('does not steal focus back after the user moves to another control', () => {
  render()
  const outside = document.createElement('button')
  document.body.append(outside)
  outside.focus()
  act(() => root.render(null))
  expect(document.activeElement).toBe(outside)
  outside.remove()
})
it('does not dismiss the panel while Escape belongs to composition', () => {
  render()
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true })))
  expect(close).not.toHaveBeenCalled()
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(close).toHaveBeenCalledOnce()
})

it('hands focus from the overflow menu into its panel without restoring the trigger over it', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  function Harness() {
    const [open, setOpen] = useState(false)
    const onClose = useCallback(() => setOpen(false), [])
    return <><TopBar settings={{ open, onToggle: () => setOpen(!open) }} />
      {open && <SlideOver title="Settings" onClose={onClose} returnFocusSelector=".topbar-overflow">
        <input aria-label="Your name" />
      </SlideOver>}</>
  }
  act(() => root.render(<Harness />))
  openReaderMenu(host)
  act(() => readerMenuItem('Settings').click())
  act(() => vi.advanceTimersByTime(100))
  expect(document.activeElement).toBe(host.querySelector('.slide-over-close'))
  act(() => host.querySelector<HTMLButtonElement>('.slide-over-close')!.click())
  expect(document.activeElement).toBe(host.querySelector('.topbar-overflow'))
})
