// @vitest-environment jsdom
import { act } from 'react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createReactHost, removeReactHost } from './helpers/dom'
import { TableViewport } from '../ui/modes/reading/TableViewport'
import { TableExpansionProvider, useTableExpansion } from '../ui/modes/reading/TableExpansion'

let host: HTMLDivElement
let root: ReturnType<typeof createReactHost>['root']
let naturalWidth: number
let windowWidth: number
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
const originalOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
function Surroundings() {
  const { hidden, collapse } = useTableExpansion()
  return <><aside inert={hidden} data-hidden={hidden}>Comments</aside><button onClick={collapse}>Open discussion</button></>
}
function Harness({ version = 'same', second = false, show = true }) {
  return <Tooltip.Provider><TableExpansionProvider><Surroundings /><div className="document-scroll">
    {show && <TableViewport contentKey={version}><table data-ps="20"><tbody><tr><td data-ps="30">Passage</td></tr></tbody></table></TableViewport>}
    {second && <TableViewport contentKey="second"><table><tbody><tr><td>Another table</td></tr></tbody></table></TableViewport>}
  </div></TableExpansionProvider></Tooltip.Provider>
}
function geometry(element: Element) {
  const width = element.tagName === 'TABLE' ? Math.min(naturalWidth, parseFloat((element as HTMLElement).style.maxWidth) || Infinity) :
    element.classList.contains('document-scroll') ? windowWidth : 600
  return { x: 0, y: 0, top: 100, bottom: 300, left: element.tagName === 'TABLE' ? 200 : 0,
    right: width, width, height: 200, toJSON() {} } as DOMRect
}
function toggle(index = 0) { act(() => host.querySelectorAll<HTMLButtonElement>('.md-table-toggle')[index]!.click()) }
async function finish() { await act(async () => { vi.advanceTimersByTime(400) }) }
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  naturalWidth = 1000; windowWidth = 1200
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return geometry(this) })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() {
    if (this.classList.contains('document-scroll')) return windowWidth
    if (this.classList.contains('md-table-scroll')) return parseFloat(this.parentElement.style.width) || 600
    return 600
  } })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.tagName === 'TABLE' ? parseFloat(this.style.width) || naturalWidth : this.clientWidth } })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return this.classList.contains('md-table-scroll') ? Math.max(parseFloat(this.querySelector('table').style.width) || naturalWidth, this.clientWidth) : this.clientWidth } })
  const style = document.createElement('style'); style.textContent = '.md-table-block { --reading-edge: 16px; --dur-fade: 260ms; --document-scrollbar-size: 6px }'; document.head.append(style)
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  document.head.replaceChildren()
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
  for (const [key, descriptor] of [['clientWidth', originalWidth], ['scrollWidth', originalScroll], ['offsetWidth', originalOffset]] as const) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, key)
  }
})
it('expands only the viewport, retaining the same table, cell anchors, and height', async () => {
  act(() => root.render(<Harness />))
  const table = host.querySelector('table')!
  const frame = host.querySelector<HTMLElement>('.md-table-viewport')!
  const original = { width: table.style.width, height: frame.style.height }
  toggle()
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('true')
  await finish()
  expect(frame.style.width).toBe('1168px')
  expect(host.querySelector('table')).toBe(table)
  expect({ width: table.style.width, height: frame.style.height }).toEqual(original)
  expect(table.querySelector('td')!.getAttribute('data-ps')).toBe('30')
  expect(host.querySelector('.md-table-scroll')!.getAttribute('data-overflow')).toBe('false')
  toggle(); await finish()
  expect(frame.style.width).toBe('600px')
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('false')
})
it('restores horizontal position and only fades edges with hidden content', async () => {
  act(() => root.render(<Harness />))
  const scroll = host.querySelector<HTMLElement>('.md-table-scroll')!
  const frame = scroll.parentElement!
  expect(frame.dataset.left).toBe('false'); expect(frame.dataset.right).toBe('true')
  scroll.scrollLeft = 400; act(() => scroll.dispatchEvent(new Event('scroll')))
  expect(frame.dataset.left).toBe('true'); expect(frame.dataset.right).toBe('false')
  toggle(); await finish(); expect(scroll.scrollLeft).toBe(0)
  toggle(); await finish(); expect(scroll.scrollLeft).toBe(400)
})
it('does not offer expansion for small tables', () => {
  naturalWidth = 300
  act(() => root.render(<Harness />))
  expect(host.querySelector('.md-table-toggle')).toBeNull()
})
it('restores surrounding UI when the table is removed or the source changes', async () => {
  act(() => root.render(<Harness />)); toggle(); await finish()
  act(() => root.render(<Harness version="edited" />))
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('false')
  toggle(); await finish(); act(() => root.render(<Harness show={false} />))
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('false')
})
it('hands expansion to another table without revealing surrounding controls', async () => {
  act(() => root.render(<Harness second />)); toggle(); await finish(); toggle(1); await finish()
  expect([...host.querySelectorAll('.md-table-toggle')].map(b => b.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('true')
})
it('collapses immediately when a discussion needs the comment rail', async () => {
  act(() => root.render(<Harness />)); toggle(); await finish()
  act(() => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(host.querySelector('.md-table-toggle')!.getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('false')
})
it('returns focus on Escape while leaving composer Escape alone', async () => {
  act(() => root.render(<Harness />)); toggle(); await finish()
  const input = document.createElement('textarea'); host.append(input)
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('.md-table-toggle')!.getAttribute('aria-expanded')).toBe('true')
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))); await finish()
  expect(document.activeElement).toBe(host.querySelector('.md-table-toggle'))
})
it('uses current geometry when reversed mid-transition and honors reduced motion', async () => {
  act(() => root.render(<Harness />)); toggle()
  await act(async () => { vi.advanceTimersByTime(80) })
  const frame = host.querySelector<HTMLElement>('.md-table-viewport')!
  expect(parseFloat(frame.style.width)).toBeGreaterThan(600)
  toggle(); await finish(); expect(frame.style.width).toBe('600px')
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  toggle(); expect(frame.style.width).toBe('1168px')
})
it('settles an interrupted expansion at the resized viewport bounds', async () => {
  act(() => root.render(<Harness />)); toggle()
  await act(async () => { vi.advanceTimersByTime(80) })
  windowWidth = 900
  act(() => window.dispatchEvent(new Event('resize')))
  await finish()
  expect(host.querySelector<HTMLElement>('.md-table-viewport')!.style.width).toBe('868px')
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('true')
})
