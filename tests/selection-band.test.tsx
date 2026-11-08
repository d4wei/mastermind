// @vitest-environment jsdom
// Selected text in the reading root is painted by a band of one rectangle per line laid over the
// text, from the live document selection and from a composer's target, leaving inline code as it is.
import { act, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rangeBetween } from './helpers/dom'
import { selectRendered } from './helpers/selection'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { MarkdownView } from '../ui/modes/reading/Renderer'
import { SELECTION_BAND_CLASS, SelectionToolbar } from '../ui/modes/reading/SelectionToolbar'
import { bandLines, rangesInSpan, selectedBoxes, wholeInlineCode } from '../ui/modes/reading/selection'
import { Notifications, useAnnouncements } from '../ui/app/Notifications'

const SOURCE = 'Run the `open` command, then `npm test` before release.'
/** The test DOM's own element geometry, restored after each stub. */
const ELEMENT_GEOMETRY = {
  getClientRects: Object.getOwnPropertyDescriptor(Element.prototype, 'getClientRects')!,
  getBoundingClientRect: Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!,
}
const restoreElementGeometry = (): void => {
  for (const [name, descriptor] of Object.entries(ELEMENT_GEOMETRY)) Object.defineProperty(Element.prototype, name, descriptor)
}

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
    Reflect.deleteProperty(Range.prototype, 'getClientRects')
    restoreElementGeometry()
    lineTop = 100
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

  /** The band's rectangles, in the article's coordinates. */
  const band = (): { top: number; left: number; width: number; height: number }[] =>
    Array.from(article().querySelectorAll<HTMLElement>(`.${SELECTION_BAND_CLASS} > div`), ({ style }) =>
      ({ top: parseFloat(style.top), left: parseFloat(style.left), width: parseFloat(style.width), height: parseFloat(style.height) }))
  /** Where the stubbed layout places the paragraph's first line. */
  let lineTop = 100
  /**
   * One line of fixed-width text: a character is 10px wide; body glyphs are 16px tall, code glyphs
   * 13px, and a code chip's border box 19px with 4px of padding at each side.
   */
  function stubLayout(): void {
    const at = (node: Node, offset: number): number => {
      const before = document.createRange()
      before.setStart(article(), 0)
      before.setEnd(node, offset)
      return before.toString().length
    }
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value(this: Range) {
      const code = this.startContainer.parentElement?.closest('code')
      return [{ top: lineTop + (code ? 2 : 0), left: at(this.startContainer, this.startOffset) * 10,
        width: this.toString().length * 10, height: code ? 13 : 16 }]
    } })
    Object.defineProperty(Element.prototype, 'getClientRects', { configurable: true, value(this: Element) {
      return this.matches('code') ? [{ top: lineTop - 1, left: at(this, 0) * 10 - 4, width: this.textContent!.length * 10 + 8, height: 19 }] : []
    } })
  }
  function openComment(): void {
    act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('.sel-toolbar button'))
      .find((button) => button.textContent === 'Comment')!.click())
  }

  const layer = (): Element | null => article().querySelector(`.${SELECTION_BAND_CLASS}`)
  const frame = async (): Promise<void> => { await act(async () => vi.advanceTimersByTimeAsync(16)) }

  it('paints the live selection as one band per line over the code chip, once a frame, and clears it', async () => {
    stubLayout()
    selectRendered(article(), 'the open command')
    changed()
    changed()
    expect(layer()).toBeNull()
    await frame()
    expect(layer()!.getAttribute('aria-hidden')).toBe('true')
    // "the ", the chip's box and its glyphs, and " command" join into one rectangle the chip's height.
    expect(band()).toEqual([{ top: 99, left: 40, width: 160, height: 19 }])
    expect(marks()).toEqual([[], []])
    selectRendered(article(), 'then npm test before')
    changed()
    await frame()
    expect(band()).toEqual([{ top: 99, left: 220, width: 200, height: 19 }])
    window.getSelection()!.removeAllRanges()
    changed()
    await frame()
    expect(layer()).toBeNull()
  })

  it('leaves a selection outside the reading root to the browser', async () => {
    stubLayout()
    const outside = document.createElement('p')
    outside.textContent = 'elsewhere'
    document.body.append(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    changed()
    await frame()
    expect(layer()).toBeNull()
    outside.remove()
  })

  it('keeps a composer target painted while focus holds the selection, and clears it on close', async () => {
    stubLayout()
    selectRendered(article(), 'the open command')
    await settle()
    openComment()
    act(() => { window.getSelection()!.removeAllRanges() })
    await settle()
    expect(band()).toEqual([{ top: 99, left: 40, width: 160, height: 19 }])
    expect(marks()).toEqual([[], []])
    act(() => host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(layer()).toBeNull()
  })

  it('returns the band to the live selection when the composer is cancelled', async () => {
    stubLayout()
    selectRendered(article(), 'the open command')
    await settle()
    openComment()
    act(() => { window.getSelection()!.removeAllRanges() })
    act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('.sel-toolbar button'))
      .find((button) => button.textContent === 'Cancel')!.click())
    expect(layer()).toBeNull()
  })

  it('re-measures the band when a table reports a layout change', async () => {
    stubLayout()
    selectRendered(article(), 'the open command')
    await settle()
    openComment()
    expect(band()[0]!.top).toBe(99)
    lineTop = 140
    act(() => { window.dispatchEvent(new Event('mastermind-table-layout')) })
    expect(band()[0]!.top).toBe(139)
    lineTop = 100
  })

  it('counts code held whole only from its first character to its last', () => {
    const [open] = code()
    const text = open!.firstChild!
    const partial = rangeBetween(article().querySelector('p')!.firstChild!.firstChild!, 4, text, 2)
    expect(wholeInlineCode([partial], article()).size).toBe(0)
    // A range from inside the code's text to its very end still holds it whole.
    expect([...wholeInlineCode([rangeBetween(text, 0, text, 4)], article())]).toEqual([open])
    expect([...wholeInlineCode([rangeBetween(text, 4, text, 4)], article())]).toEqual([])
  })

  it('finds no code outside the reading root', () => {
    const outside = document.createElement('p')
    outside.innerHTML = 'see <code data-atom="code">elsewhere</code> too'
    document.body.append(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    expect(wholeInlineCode([range], article()).size).toBe(0)
    outside.remove()
  })
})

describe('the band geometry', () => {
  const box = (left: number, top: number, width: number, height: number) => ({ top, left, width, height })

  it('merges the boxes on each line into one rectangle at the line union\'s height', () => {
    expect(bandLines([
      box(0, 100, 40, 16), box(36, 99, 48, 19), box(40, 102, 40, 13), box(84, 100, 60, 16),
      box(0, 124, 30, 16), box(30, 124, 20, 16),
    ])).toEqual([box(0, 99, 144, 19), box(0, 124, 50, 16)])
  })

  it('keeps separated boxes on one line apart at the same height and drops empty ones', () => {
    expect(bandLines([box(0, 100, 20, 16), box(60, 99, 20, 18), box(20, 100, 0, 16)]))
      .toEqual([box(0, 99, 20, 18), box(60, 99, 20, 18)])
  })

  it('takes text and whole inline code, never the box of a block the range holds whole', () => {
    const root = document.createElement('article')
    root.innerHTML = '<p>one</p><p>two <code data-atom="code">x</code></p><p>three</p>'
    document.body.append(root)
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true,
      value(this: Range) { return [{ top: 0, left: 0, width: this.toString().length, height: 1 }] } })
    Object.defineProperty(Element.prototype, 'getClientRects', { configurable: true,
      value(this: Element) { return [{ top: 0, left: 0, width: this.matches('code') ? 7 : 1000, height: 1 }] } })
    const range = document.createRange()
    range.setStart(root.firstChild!.firstChild!, 1)
    range.setEnd(root.lastChild!.firstChild!, 2)
    expect(selectedBoxes([range], root).map(({ width }) => width)).toEqual(['ne'.length, 'two '.length, 'x'.length, 'th'.length, 7])
    Reflect.deleteProperty(Range.prototype, 'getClientRects')
    restoreElementGeometry()
    root.remove()
  })

  it('narrows a long selection to the blocks near the viewport and reports what it left out', () => {
    const root = document.createElement('article')
    root.innerHTML = '<p>zero</p><p>one</p><p>two</p><p>three</p><p>four</p><div class="sel-band"></div>'
    document.body.append(root)
    const blocks = Array.from(root.querySelectorAll('p'))
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', { configurable: true, value(this: Element) {
      const index = blocks.indexOf(this as HTMLParagraphElement)
      // The band layer covers the whole root and must not steer the search.
      return index < 0 ? { top: 0, bottom: 500, height: 500 } : { top: index * 100, bottom: index * 100 + 100, height: 100 }
    } })
    const range = document.createRange()
    range.setStart(blocks[0]!.firstChild!, 1)
    range.setEnd(blocks[4]!.firstChild!, 2)
    const span = { top: 150, bottom: 320 }
    const near = rangesInSpan([range], root, span)
    expect(near.ranges.map(String)).toEqual(['one', 'two', 'three'])
    expect(near.partial).toBe(true)
    const inside = document.createRange()
    inside.setStart(blocks[2]!.firstChild!, 0)
    inside.setEnd(blocks[3]!.firstChild!, 2)
    expect(rangesInSpan([inside], root, span)).toEqual({ ranges: [expect.anything(), expect.anything()], partial: false })
    expect(rangesInSpan([inside], root, span).ranges.map(String)).toEqual(['two', 'th'])
    const far = document.createRange()
    far.setStart(blocks[4]!.firstChild!, 0)
    far.setEnd(blocks[4]!.firstChild!, 4)
    expect(rangesInSpan([far], root, span).ranges.map(String)).toEqual(['four'])
    restoreElementGeometry()
    root.remove()
  })
})
