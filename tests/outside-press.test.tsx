// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isOutsidePress, useOutsidePress, type Layer, type OutsidePressOptions } from '../ui/util/outside-press'

let host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  host.innerHTML = `
    <p class="page"><button class="toggle">Toggle</button></p>
    <div class="layer" data-layer><button class="own">Own</button></div>
    <div class="panel" data-layer><div class="hosted"></div><span class="blank"></span></div>
    <div data-layer class="notice"><button class="dismiss">Dismiss</button></div>
    <div data-radix-popper-content-wrapper><div role="menuitem" class="item">Item</div></div>`
  document.body.append(host)
})
afterEach(() => {
  host.remove()
  document.getElementById('root')?.remove()
  document.querySelector('.close-dialog')?.remove()
  vi.unstubAllGlobals()
})
const $ = (selector: string) => host.querySelector(selector)!

it('treats the layer, its inside surfaces, and other floating layers as inside', () => {
  const layer: Layer = { element: $('.layer'), inside: '.toggle' }
  expect(isOutsidePress($('.page'), layer)).toBe(true)
  for (const kept of ['.own', '.toggle', '.dismiss', '.item']) expect(isOutsidePress($(kept), layer)).toBe(false)
  expect(isOutsidePress($('.page'), { element: $('.layer'), inside: (target) => target.matches('.page') })).toBe(false)
})

it('lets a layer nested with the host, either way round, leave its presses outside', () => {
  // The discussion has no element of its own: its surfaces are `inside`, and it sits in `host`.
  const hosted: Layer = { host: $('.hosted'), inside: '.never' }
  expect(isOutsidePress($('.blank'), hosted)).toBe(true)
  expect(isOutsidePress($('.blank'), { host: $('.panel') })).toBe(true)
  expect(isOutsidePress($('.dismiss'), hosted)).toBe(false)
  expect(isOutsidePress($('.blank'), {})).toBe(false)
  expect(isOutsidePress($('.page'), {})).toBe(true)
})

it('finds no press outside while a modal is up, or on a target the press removed', () => {
  const layer: Layer = { element: $('.layer') }
  const removed = document.createElement('button')
  expect(isOutsidePress(removed, layer)).toBe(false)
  expect(isOutsidePress(null, layer)).toBe(false)
  const dialog = document.createElement('dialog')
  dialog.className = 'close-dialog'; dialog.setAttribute('open', ''); document.body.append(dialog)
  expect(isOutsidePress($('.page'), layer)).toBe(false)
  dialog.remove()
  const app = document.createElement('div'); app.id = 'root'; app.inert = true; document.body.append(app)
  expect(isOutsidePress($('.page'), layer)).toBe(false)
})

function mount(options: OutsidePressOptions, onOutside: () => void): Root {
  const root = createRoot(document.createElement('div'))
  function Probe() {
    useOutsidePress(() => ({ element: $('.layer') }), onOutside, options)
    return null
  }
  act(() => root.render(<Probe />))
  return root
}

it('acts on a press in the capture phase without preventing its default', () => {
  const onOutside = vi.fn()
  const root = mount({}, onOutside)
  $('.page').addEventListener('pointerdown', (event) => event.stopPropagation())
  const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
  $('.page').dispatchEvent(event)
  expect(onOutside).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(false)
  $('.own').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  expect(onOutside).toHaveBeenCalledOnce()
  act(() => root.unmount())
})

it('stays idle while disabled', () => {
  const onOutside = vi.fn()
  const root = mount({ enabled: false }, onOutside)
  $('.page').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  expect(onOutside).not.toHaveBeenCalled()
  act(() => root.unmount())
})

it('in click mode, ignores drags and measures each click only from its own press', () => {
  const onOutside = vi.fn()
  const root = mount({ on: 'click' }, onOutside)
  const page = $('.page')
  const pointer = (type: string, x: number) => page.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x }))
  const click = (x: number) => page.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x }))
  page.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  expect(onOutside).not.toHaveBeenCalled()
  pointer('pointerdown', 0); click(40)
  expect(onOutside).not.toHaveBeenCalled()
  // A press forgotten by a key or a cancelled pointer cannot make a later click a drag.
  pointer('pointerdown', 0); page.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); click(40)
  expect(onOutside).toHaveBeenCalledOnce()
  pointer('pointerdown', 0); pointer('pointercancel', 0); click(40)
  expect(onOutside).toHaveBeenCalledTimes(2)
  page.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2 }))
  expect(onOutside).toHaveBeenCalledTimes(2)
  act(() => root.unmount())
})
