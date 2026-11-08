// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FindPanel } from '../ui/find/FindPanel'
import { stubHighlights } from './helpers/dom'
import { openOverlay, requestFind, useOverlay } from '../ui/app/overlayStore'
import { useConfig } from '../ui/app/configStore'

let host: HTMLDivElement
let root: Root
let serial = 0
const close = vi.fn()

function Harness() {
  const docRef = useRef<HTMLElement>(null)
  return <div className="app-content">
    <button className="prior">Prior</button>
    <button data-find-trigger="" onClick={requestFind}>Find</button>
    <button className="menu-trigger" onPointerDown={() => openOverlay('menu', 'doc')}>More</button>
    <div className="document-scroll"><article ref={docRef}><p>Review the proposal. Review it again.</p></article></div>
    <FindPanel sessionId={`outside-${serial}`} source="" mode="reading" docRef={docRef}
      analysis={null} onClose={close} onRevealComment={() => {}} />
  </div>
}

const bar = () => host.querySelector('[role="search"]')
const input = () => host.querySelector<HTMLInputElement>('.find-input')!
const press = (target: Element) => {
  const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
  act(() => { target.dispatchEvent(event) })
  return event
}
const openFromPrior = () => {
  host.querySelector<HTMLButtonElement>('.prior')!.focus()
  act(() => requestFind())
  expect(document.activeElement).toBe(input())
}

beforeEach(() => {
  serial++
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  stubHighlights(new Map())
  Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 120 } as DOMRect)
  useConfig.setState({ config: { ...useConfig.getState().config!, uiLang: 'en' } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<Harness />))
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  document.getElementById('root')?.remove()
  document.querySelector('.close-dialog')?.remove()
  document.querySelector('[data-radix-popper-content-wrapper]')?.remove()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks()
})

it('closes on a press in the document, restoring focus without blocking the press or losing the query', () => {
  openFromPrior()
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), 'Review')
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
  const paragraph = host.querySelector('p')!
  // The document swallowing the press does not keep Find open.
  paragraph.addEventListener('pointerdown', (event) => event.stopPropagation())
  const event = press(paragraph)
  expect(bar()).toBeNull()
  expect(useOverlay.getState().open).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('.prior'))
  expect(event.defaultPrevented).toBe(false)
  expect(close).toHaveBeenCalledTimes(1)
  act(() => requestFind())
  expect(input().value).toBe('Review')
})

it('stays open for a press on the Find trigger, whose click then refocuses the field', () => {
  openFromPrior()
  const trigger = host.querySelector<HTMLButtonElement>('[data-find-trigger]')!
  press(trigger)
  expect(bar()).not.toBeNull()
  trigger.focus()
  act(() => trigger.click())
  expect(bar()).not.toBeNull()
  expect(document.activeElement).toBe(input())
})

it('stays open for presses inside the bar', () => {
  openFromPrior()
  press(input())
  press(host.querySelector('button[aria-label="Match case"]')!)
  expect(bar()).not.toBeNull()
  expect(close).not.toHaveBeenCalled()
})

it('still closes on Escape', () => {
  openFromPrior()
  act(() => { input().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })) })
  expect(bar()).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('.prior'))
})

it('closes once when the press opens another overlay', () => {
  openFromPrior()
  press(host.querySelector('.menu-trigger')!)
  expect(bar()).toBeNull()
  expect(useOverlay.getState().open).toBe('menu')
  expect(close).toHaveBeenCalledTimes(1)
})

it.each([
  ['inside portaled menu or popover content', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-radix-popper-content-wrapper', '')
    const item = document.createElement('div'); wrapper.append(item); document.body.append(wrapper)
    return item
  }],
  ['while the close dialog is up', () => {
    const dialog = document.createElement('dialog')
    dialog.className = 'close-dialog'; dialog.setAttribute('open', ''); document.body.append(dialog)
    return host.querySelector('p')!
  }],
  ['while the app root is inert', () => {
    const app = document.createElement('div'); app.id = 'root'; app.inert = true; document.body.append(app)
    return host.querySelector('p')!
  }],
] as const)('stays open for a press %s', (_, target) => {
  openFromPrior()
  press(target())
  expect(bar()).not.toBeNull()
  expect(close).not.toHaveBeenCalled()
})
