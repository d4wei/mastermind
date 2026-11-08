// @vitest-environment jsdom
// Selection painting fills glyphs only, so inline code the selected band holds whole is marked to
// fill its padding: in the live document selection, and in a composer's target highlight.
import { act, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rangeBetween } from './helpers/dom'
import { selectRendered } from './helpers/selection'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { MarkdownView } from '../ui/modes/reading/Renderer'
import { SELECTED_CODE_CLASS, SelectionToolbar } from '../ui/modes/reading/SelectionToolbar'
import { wholeInlineCode } from '../ui/modes/reading/selection'
import { Notifications, useAnnouncements } from '../ui/app/Notifications'

const SOURCE = 'Run the `open` command, then `npm test` before release.'

describe('the selected band across inline code', () => {
  let host: HTMLElement
  let root: ReturnType<typeof createRoot>

  function Review() {
    const ref = useRef<HTMLElement>(null)
    const analysis = useMemo(() => analyzeMarkdown(SOURCE), [])
    return <Notifications><article ref={ref}><MarkdownView analysis={analysis} ctx={{ source: SOURCE }} /></article>
      <SelectionToolbar containerRef={ref} source={SOURCE} analysis={analysis} authorTag="Alex" onEdit={() => true} /></Notifications>
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true, value: () => ({ top: 100, left: 100, width: 40 }),
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root.render(<Review />))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    window.getSelection()?.removeAllRanges()
    useAnnouncements.setState({ items: [] })
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const article = (): HTMLElement => host.querySelector('article')!
  const code = (): HTMLElement[] => Array.from(article().querySelectorAll('code'))
  /** The classes each inline code element carries beyond its own. */
  const marks = (): string[][] => code().map((element) =>
    Array.from(element.classList).filter((name) => name !== 'md-inline-code'))
  const changed = (): void => act(() => { document.dispatchEvent(new Event('selectionchange')) })
  async function settle(): Promise<void> {
    changed()
    await act(async () => vi.advanceTimersByTimeAsync(120))
  }

  it('marks code a text–code–text selection holds and follows the selection as it moves or clears', async () => {
    selectRendered(article(), 'the open command')
    await settle()
    expect(host.querySelector('.sel-toolbar')).not.toBeNull()
    expect(marks()).toEqual([[SELECTED_CODE_CLASS.selection], []])
    // The mark follows each selection change at once, without waiting for the toolbar to settle.
    selectRendered(article(), 'then npm test before')
    changed()
    expect(marks()).toEqual([[], [SELECTED_CODE_CLASS.selection]])
    window.getSelection()!.removeAllRanges()
    changed()
    expect(marks()).toEqual([[], []])
  })

  it('marks the composer target while focus has taken the document selection, and clears it on close', async () => {
    selectRendered(article(), 'the open command')
    await settle()
    act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('.sel-toolbar button'))
      .find((button) => button.textContent === 'Comment')!.click())
    expect(marks()).toEqual([[SELECTED_CODE_CLASS.target], []])
    act(() => { window.getSelection()!.removeAllRanges() })
    await settle()
    expect(marks()).toEqual([[SELECTED_CODE_CLASS.target], []])
    act(() => host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(marks()).toEqual([[], []])
  })

  it('leaves code the selection only partly holds to the glyph fill', () => {
    const [open] = code()
    const text = open!.firstChild!
    const partial = rangeBetween(article().querySelector('p')!.firstChild!.firstChild!, 4, text, 2)
    expect(wholeInlineCode([partial], article()).size).toBe(0)
    // A range from inside the code's text to its very end still holds it whole.
    expect([...wholeInlineCode([rangeBetween(text, 0, text, 4)], article())]).toEqual([open])
    expect([...wholeInlineCode([rangeBetween(text, 4, text, 4)], article())]).toEqual([])
  })

  it('marks nothing outside the reading root', () => {
    const outside = document.createElement('p')
    outside.innerHTML = 'see <code data-atom="code">elsewhere</code> too'
    document.body.append(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    expect(wholeInlineCode([range], article()).size).toBe(0)
    outside.remove()
  })
})
