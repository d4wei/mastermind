// @vitest-environment jsdom
import { act, useMemo, useRef, useState, type RefObject } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { CommentRail } from '../ui/review/CommentRail'
import type { ReplyDraft } from '../ui/review/thread-identity'
import { createReactHost, removeReactHost } from './helpers/dom'

const messages = vi.hoisted(() => ({ renders: 0 }))
vi.mock('../ui/review/ThreadMessage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/review/ThreadMessage')>()
  return { ThreadMessage: (props: Parameters<typeof actual.ThreadMessage>[0]) => {
    messages.renders++
    return <actual.ThreadMessage {...props} />
  } }
})

const SOURCE = '{==alpha==}{>>@a: one<<} text {==beta==}{>>@b: two<<}{>>@c: a reply<<}\n'
const ANALYSIS = analyzeMarkdown(SOURCE)

let host: HTMLDivElement
let root: Root
let observers: { callback: ResizeObserverCallback; observed: Set<Element>; everObserved: Set<Element> }[]
/** Rendered heights by card order, and each anchor's top by span index. */
let heights: number[]
let anchorTops: Map<number, number>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  observers = []
  vi.stubGlobal('ResizeObserver', class {
    private readonly record: (typeof observers)[number]
    constructor(callback: ResizeObserverCallback) { this.record = { callback, observed: new Set(), everObserved: new Set() }; observers.push(this.record) }
    observe(element: Element) { this.record.observed.add(element); this.record.everObserved.add(element) }
    unobserve(element: Element) { this.record.observed.delete(element) }
    disconnect() { this.record.observed.clear() }
  })
  heights = [100, 50]
  anchorTops = new Map(ANALYSIS.threads.map((card) => [card.spanIndex, 0]))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = [...document.querySelectorAll('.rail-card')].indexOf(this)
    const span = this.matches('article [data-span-index]') ? Number(this.dataset.spanIndex) : NaN
    return { top: anchorTops.get(span) ?? 0, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0,
      height: heights[index] ?? 0, toJSON: () => ({}) }
  })
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

let select: (span: number | null) => void
function Harness() {
  const analysis = useMemo(() => ANALYSIS, [])
  const docRef = useRef<HTMLElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<ReplyDraft[]>([])
  select = setActive
  return <><article ref={docRef}>
    {ANALYSIS.threads.map((card) => <mark key={card.key} data-span-index={card.spanIndex} />)}
  </article>
    <CommentRail source={SOURCE} analysis={analysis} docRef={docRef as RefObject<HTMLElement | null>} authorTag="reviewer"
      activeSpan={active} onActivate={setActive} onEdit={() => true} drafts={drafts} onDraftsChange={setDrafts} /></>
}
const cards = () => [...host.querySelectorAll<HTMLElement>('.rail-card')]
const doc = () => host.querySelector('article')!
/** What the browser reports for `target` after layout, its border box `height` tall. */
const entry = (target: Element, height: number) =>
  ({ target, borderBoxSize: [{ blockSize: height, inlineSize: 0 }] }) as unknown as ResizeObserverEntry
/** One observation, delivered as the browser does: outside React, after layout and before paint. */
function observe(entries: ResizeObserverEntry[]) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
  for (const observer of observers) {
    const observed = entries.filter((item) => observer.observed.has(item.target))
    if (observed.length) observer.callback(observed, {} as ResizeObserver)
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
}

it('places an easing card frame by frame without rendering cards or looking anchors up again', () => {
  act(() => root.render(<Harness />))
  expect(cards().map((card) => card.style.top)).toEqual(['0px', '108px'])
  const rendered = messages.renders
  const lookups = vi.fn()
  for (const target of [Element.prototype, Document.prototype]) {
    for (const method of ['querySelector', 'querySelectorAll'] as const) {
      const original = target[method] as (selectors: string) => unknown
      vi.spyOn(target, method).mockImplementation(function (this: ParentNode, selectors: string) {
        if (selectors.includes('data-span-index')) lookups(selectors)
        return original.call(this, selectors)
      } as never)
    }
  }
  for (let frame = 1; frame <= 5; frame++) {
    heights = [100 + frame * 10, 50]
    observe([entry(cards()[0]!, heights[0]!)])
    expect(cards()[1]!.style.top).toBe(`${108 + frame * 10}px`)
  }
  expect(lookups).not.toHaveBeenCalled()
  expect(messages.renders - rendered).toBe(0)
})

it('keeps one observer across selection changes and re-places anchors only when the document resizes', () => {
  act(() => root.render(<Harness />))
  act(() => select(ANALYSIS.threads[1]!.spanIndex))
  act(() => select(null))
  // Each passage keeps its own observer; one watches the document for the rail's lifetime.
  expect(observers.filter((observer) => observer.everObserved.has(doc()))).toHaveLength(1)
  anchorTops.set(ANALYSIS.threads[1]!.spanIndex, 300)
  observe([entry(cards()[0]!, 100)])
  expect(cards()[1]!.style.top).toBe('108px')
  observe([entry(doc(), 0)])
  expect(cards()[1]!.style.top).toBe('300px')
})
