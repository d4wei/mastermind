// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createReactHost, removeReactHost } from './helpers/dom'
import { TableViewport } from '../ui/modes/reading/TableViewport'
import { SlideOver } from '../ui/app/SlideOver'
import { TableExpansionProvider, useTableExpansion } from '../ui/modes/reading/TableExpansion'

let host: HTMLDivElement
let root: ReturnType<typeof createReactHost>['root']
let naturalWidth: number
let windowWidth: number
let hostLeft: number
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
const originalOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
const closePanel = vi.fn()
function Surroundings({ panel }: { panel: boolean }) {
  const { hidden, collapse } = useTableExpansion()
  return <><aside inert={hidden} data-hidden={hidden}>{panel
    ? <SlideOver title="Comments" onClose={closePanel} returnFocus=".md-table-toggle">Comments</SlideOver> : 'Comments'}</aside>
    <button onClick={collapse}>Open discussion</button></>
}
function Harness({ version = 'same', second = false, show = true, panel = false }) {
  return <Tooltip.Provider><TableExpansionProvider><Surroundings panel={panel} /><div className="document-scroll">
    {show && <TableViewport contentKey={version}><table data-ps="20"><tbody><tr><td data-ps="30">Passage</td></tr></tbody></table></TableViewport>}
    {second && <TableViewport contentKey="second"><table><tbody><tr><td>Another table</td></tr></tbody></table></TableViewport>}
  </div></TableExpansionProvider></Tooltip.Provider>
}
function Pair({ source, first = 'first' }: { source: string; first?: string }) {
  return <Tooltip.Provider><TableExpansionProvider><Surroundings panel={false} /><div className="document-scroll">
    <TableViewport contentKey={first} source={source}><table id="first"><tbody><tr><td>Passage</td></tr></tbody></table></TableViewport>
    <TableViewport contentKey="second" source={source}><table id="second"><tbody><tr><td>Another table</td></tr></tbody></table></TableViewport>
  </div></TableExpansionProvider></Tooltip.Provider>
}
function tableReads() {
  const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.contexts as HTMLElement[]
  return { first: reads.filter((e) => e.id === 'first').length, second: reads.filter((e) => e.id === 'second').length }
}
function geometry(element: Element) {
  const width = element.tagName === 'TABLE' ? Math.min(naturalWidth, parseFloat((element as HTMLElement).style.maxWidth) || Infinity) :
    element.classList.contains('document-scroll') ? windowWidth : 600
  const left = element.tagName === 'TABLE' ? 200 : element.classList.contains('md-table-block') ? hostLeft : 0
  return { x: 0, y: 0, top: 100, bottom: 300, left,
    right: width, width, height: 200, toJSON() {} } as DOMRect
}
function toggle(index = 0) { act(() => host.querySelectorAll<HTMLButtonElement>('.md-table-toggle')[index]!.click()) }
/** Table measurement runs in a microtask batch after the commit, so rendering awaits it. */
async function show(element: ReactElement) { await act(async () => root.render(element)) }
async function finish() { await act(async () => { vi.advanceTimersByTime(400) }) }
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  naturalWidth = 1000; windowWidth = 1200; hostLeft = 0
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
  await show(<Harness />)
  const table = host.querySelector('table')!
  const frame = host.querySelector<HTMLElement>('.md-table-viewport')!
  const original = { width: table.style.width, height: frame.style.height }
  toggle()
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('true')
  await finish()
  expect(frame.style.width).toBe('1000px')
  expect(frame.style.marginLeft).toBe('16px')
  expect(host.querySelector('table')).toBe(table)
  expect({ width: table.style.width, height: frame.style.height }).toEqual(original)
  expect(table.querySelector('td')!.getAttribute('data-ps')).toBe('30')
  expect(host.querySelector('.md-table-scroll')!.getAttribute('data-overflow')).toBe('false')
  toggle(); await finish()
  expect(frame.style.width).toBe('600px')
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('false')
})
it('restores horizontal position and only fades edges with hidden content', async () => {
  await show(<Harness />)
  const scroll = host.querySelector<HTMLElement>('.md-table-scroll')!
  const frame = scroll.parentElement!
  expect(frame.dataset.left).toBe('false'); expect(frame.dataset.right).toBe('true')
  scroll.scrollLeft = 400; act(() => scroll.dispatchEvent(new Event('scroll')))
  expect(frame.dataset.left).toBe('true'); expect(frame.dataset.right).toBe('false')
  toggle(); await finish(); expect(scroll.scrollLeft).toBe(0)
  toggle(); await finish(); expect(scroll.scrollLeft).toBe(400)
})
it('labels the expansion control with a themed tooltip arrow', async () => {
  await show(<Harness />)
  act(() => host.querySelector<HTMLButtonElement>('.md-table-toggle')!.focus())
  await finish()
  expect(document.querySelector('.tooltip .tooltip-arrow')).not.toBeNull()
})
it('does not offer expansion for small tables', async () => {
  naturalWidth = 300
  await show(<Harness />)
  expect(host.querySelector('.md-table-toggle')).toBeNull()
})
it('restores surrounding UI when the table is removed or the source changes', async () => {
  await show(<Harness />); toggle(); await finish()
  await show(<Harness version="edited" />)
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('false')
  toggle(); await finish(); await show(<Harness show={false} />)
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('false')
})
it('hands expansion to another table without revealing surrounding controls', async () => {
  await show(<Harness second />); toggle(); await finish(); toggle(1); await finish()
  expect([...host.querySelectorAll('.md-table-toggle')].map(b => b.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('true')
})
it('collapses immediately when a discussion needs the comment rail', async () => {
  await show(<Harness />); toggle(); await finish()
  act(() => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(host.querySelector('.md-table-toggle')!.getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('false')
})
it('returns focus on Escape while leaving composer Escape alone', async () => {
  await show(<Harness />); toggle(); await finish()
  const input = document.createElement('textarea'); host.append(input)
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('.md-table-toggle')!.getAttribute('aria-expanded')).toBe('true')
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))); await finish()
  expect(document.activeElement).toBe(host.querySelector('.md-table-toggle'))
})
it('ignores an Escape the input method consumes after composition ends', async () => {
  await show(<Harness />); toggle(); await finish()
  const imeEscape = new KeyboardEvent('keydown', { key: 'Escape' })
  Object.defineProperty(imeEscape, 'keyCode', { value: 229 })
  act(() => window.dispatchEvent(imeEscape)); await finish()
  expect(host.querySelector('.md-table-toggle')!.getAttribute('aria-expanded')).toBe('true')
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))); await finish()
  expect(host.querySelector('.md-table-toggle')!.getAttribute('aria-expanded')).toBe('false')
})
it('uses current geometry when reversed mid-transition and honors reduced motion', async () => {
  await show(<Harness />); toggle()
  await act(async () => { vi.advanceTimersByTime(80) })
  const frame = host.querySelector<HTMLElement>('.md-table-viewport')!
  expect(parseFloat(frame.style.width)).toBeGreaterThan(600)
  toggle(); await finish(); expect(frame.style.width).toBe('600px')
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  toggle(); expect(frame.style.width).toBe('1000px')
})
it('settles an interrupted expansion at the resized viewport bounds', async () => {
  await show(<Harness />); toggle()
  await act(async () => { vi.advanceTimersByTime(80) })
  windowWidth = 900
  act(() => window.dispatchEvent(new Event('resize')))
  await finish()
  expect(host.querySelector<HTMLElement>('.md-table-viewport')!.style.width).toBe('868px')
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('true')
})
it('leaves Escape to an open settings panel', async () => {
  await show(<Harness />); toggle(); await finish()
  const panel = document.createElement('div')
  panel.className = 'slide-over'; panel.setAttribute('role', 'dialog')
  document.body.append(panel)
  try {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))); await finish()
    expect(host.querySelector('.md-table-toggle')!.getAttribute('aria-expanded')).toBe('true')
  } finally { panel.remove() }
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))); await finish()
  expect(host.querySelector('.md-table-toggle')!.getAttribute('aria-expanded')).toBe('false')
})
it('collapses on Escape while the panel it hid stays open', async () => {
  closePanel.mockClear()
  await show(<Harness panel />); toggle(); await finish()
  expect(host.querySelector('aside')!.hasAttribute('inert')).toBe(true)
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))); await finish()
  expect(host.querySelector('.md-table-toggle')!.getAttribute('aria-expanded')).toBe('false')
  expect(closePanel).not.toHaveBeenCalled()
})
it('reserves the scroll gap below the table so an overlay scrollbar clears the last row', async () => {
  const style = document.createElement('style'); style.textContent = '.md-table-scroll { padding-bottom: 12px }'; document.head.append(style)
  await show(<Harness />)
  expect(host.querySelector<HTMLElement>('.md-table-viewport')!.style.height).toBe('218px')
})
it('centers an expanded table narrower than the window on the reading column', async () => {
  windowWidth = 3000; hostLeft = 1200
  await show(<Harness />); toggle(); await finish()
  const frame = host.querySelector<HTMLElement>('.md-table-viewport')!
  expect({ width: frame.style.width, left: frame.style.marginLeft }).toEqual({ width: '1000px', left: '-200px' })
})
it('fills the window when the table is wider than it', async () => {
  naturalWidth = 1400
  await show(<Harness />); toggle(); await finish()
  const frame = host.querySelector<HTMLElement>('.md-table-viewport')!
  expect({ width: frame.style.width, left: frame.style.marginLeft }).toEqual({ width: '1168px', left: '16px' })
})
it('releases expansion on any source change while measuring only the table whose content changed', async () => {
  await show(<Pair source="a" />); toggle(); await finish()
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('true')
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockClear()
  await show(<Pair source="b" />)
  expect(host.querySelector('.md-table-toggle')!.getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelector('aside')!.getAttribute('data-hidden')).toBe('false')
  expect(host.querySelector<HTMLElement>('#first')!.parentElement!.parentElement!.style.width).toBe('600px')
  expect(tableReads()).toEqual({ first: 0, second: 0 })
  await show(<Pair source="c" first="edited" />)
  expect(tableReads().first).toBeGreaterThan(0)
  expect(tableReads().second).toBe(0)
})
it('measures every table in one batch when the window resizes', async () => {
  await show(<Pair source="a" />)
  const layouts = vi.fn(); window.addEventListener('mastermind-table-layout', layouts)
  windowWidth = 900
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockClear()
  await act(async () => { window.dispatchEvent(new Event('resize')) })
  window.removeEventListener('mastermind-table-layout', layouts)
  expect(layouts).toHaveBeenCalledTimes(1)
  expect(tableReads().first).toBeGreaterThan(0)
  expect(tableReads().second).toBeGreaterThan(0)
  expect([...host.querySelectorAll<HTMLElement>('.md-table-viewport')].map((frame) => frame.style.width)).toEqual(['600px', '600px'])
})
