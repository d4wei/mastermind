// @vitest-environment jsdom
import { act, useMemo, useRef, useState, type RefObject } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { CommentRail } from '../ui/review/CommentRail'
import { FindPanel } from '../ui/find/FindPanel'
import { threadRef, type ReplyDraft } from '../ui/review/thread-identity'
import { useConfig } from '../ui/app/configStore'
import { createReactHost, removeReactHost, stubHighlights } from './helpers/dom'
import { scrollDocument, stubDocumentLayout, type DocumentLayout } from './helpers/layout'

/** Forty discussions of equal content length, so one measured card calibrates every estimate exactly. */
const SOURCE = Array.from({ length: 40 }, (_, i) => {
  const n = String(i).padStart(2, '0')
  return `Paragraph {==w${n}==}{>>@a: comment ${n}<<}`
}).join('\n\n') + '\n'
const GAP = 8

let host: HTMLDivElement
let root: Root
let layout: DocumentLayout
let restoreLayout: () => void
/** Each card's height by its passage, where it differs from 100 px. */
let heights: Map<string, number>
let railWidth: number
let observers: { callback: ResizeObserverCallback; observed: Set<Element> }[]
const highlights = new Map<string, Set<Range>>()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Reduced motion, so reveals scroll at once.
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  observers = []
  vi.stubGlobal('ResizeObserver', class {
    private readonly record: (typeof observers)[number]
    constructor(callback: ResizeObserverCallback) { this.record = { callback, observed: new Set() }; observers.push(this.record) }
    observe(element: Element) { this.record.observed.add(element) }
    unobserve(element: Element) { this.record.observed.delete(element) }
    disconnect() { this.record.observed.clear() }
  })
  stubHighlights(highlights)
  useConfig.setState({ config: { ...useConfig.getState().config!, uiLang: 'en' } })
  heights = new Map()
  railWidth = 300
  // Anchors 500 px apart; a 1,000 px viewport with its margins reaches 2,500 px.
  layout = { viewport: 1000, anchorTop: (anchor) => 500 * marks().indexOf(anchor),
    cardHeight: (card) => heights.get(passageOf(card)) ?? 100 }
  restoreLayout = stubDocumentLayout(layout)
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('rail') ? railWidth : 0
  })
  Range.prototype.getBoundingClientRect = function (this: Range) {
    return (this.startContainer.parentElement ?? document.body).getBoundingClientRect()
  }
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  restoreLayout()
  highlights.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

let select: (span: number | null) => void
let focusDiscussion: (span: number | null) => void
let setSource: (source: string) => void
let setDrafts: (drafts: ReplyDraft[]) => void
function Harness({ initial = SOURCE, find = false }: { initial?: string; find?: boolean }) {
  const [source, changeSource] = useState(initial)
  const analysis = useMemo(() => analyzeMarkdown(source), [source])
  const docRef = useRef<HTMLElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const [drafts, changeDrafts] = useState<ReplyDraft[]>([])
  select = setActive
  focusDiscussion = setFocused
  setSource = changeSource
  setDrafts = changeDrafts
  return <div className="app-content">
    <div className="document-scroll">
      <article ref={docRef}>{analysis.threads.map((card) => <p key={card.key}>
        <mark className="critic-anchor" data-span-index={card.spanIndex}>{card.anchorText}</mark>
      </p>)}</article>
      <CommentRail source={source} analysis={analysis} docRef={docRef as RefObject<HTMLElement | null>} authorTag="reviewer"
        activeSpan={active} focusedSpan={focused} onFocusSpan={setFocused} onActivate={setActive} onEdit={() => true}
        drafts={drafts} onDraftsChange={changeDrafts as never} />
    </div>
    {find && <FindPanel sessionId="window" source={source} mode="reading" docRef={docRef} analysis={analysis}
      onRevealComment={setActive} onClose={() => {}} />}
  </div>
}

const ANALYSIS = analyzeMarkdown(SOURCE)
const marks = () => [...document.querySelectorAll<HTMLElement>('article [data-span-index]')]
const scroller = () => host.querySelector<HTMLElement>('.document-scroll')!
const cards = () => [...host.querySelectorAll<HTMLElement>('.rail-card')]
function passageOf(card: HTMLElement): string { return card.querySelector('.rail-card-anchor')?.getAttribute('title') ?? '' }
/** The passages of the mounted cards, in DOM order. */
const mounted = () => cards().map(passageOf)
const cardFor = (passage: string) => cards().find((card) => passageOf(card) === passage)
const w = (i: number) => `w${String(i).padStart(2, '0')}`
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => w(from + i))
const span = (i: number) => ANALYSIS.threads[i]!.spanIndex
/** Lets frame callbacks run: the rail's window, and reveals. */
const frames = () => act(async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
})
/** One observation of `target`, as the browser reports it after layout. */
function resized(target: Element) {
  act(() => {
    for (const { callback, observed } of observers) {
      if (observed.has(target)) callback([{ target } as unknown as ResizeObserverEntry], {} as ResizeObserver)
    }
  })
}
const documentResized = () => resized(host.querySelector('article')!)
/** The card's top edge shows in the viewport. */
const inView = (element: HTMLElement) => {
  const { top } = element.getBoundingClientRect()
  return top >= 0 && top < layout.viewport
}
const topOf = (passage: string) => parseFloat(cardFor(passage)!.style.top)

it('mounts only the cards near the viewport and keeps the rail its full height', async () => {
  act(() => root.render(<Harness />))
  // Anchors 0 to 2,500 px fall within the viewport and its margin.
  expect(mounted()).toEqual(range(0, 6))
  expect(cardFor(w(5))!.style.top).toBe('2500px')
  expect(host.querySelector<HTMLElement>('.rail')!.style.height).toBe(`${500 * 39 + 100}px`)
  await act(() => scrollDocument(scroller(), 10_000))
  // 8,500 to 12,500 px, counting the cards whose box reaches 8,500.
  expect(mounted()).toEqual(range(17, 26))
  expect(cardFor(w(20))!.style.top).toBe('10000px')
})

it('keeps the selected, focused, and drafting cards mounted wherever they are', async () => {
  act(() => root.render(<Harness />))
  act(() => select(span(30)))
  expect(mounted()).toEqual([...range(0, 6), w(30)])
  expect(cardFor(w(30))!.classList.contains('active')).toBe(true)
  // The composer the selection opens keeps a draft; the draft keeps its card after the selection ends.
  act(() => setDrafts([{ id: 1, thread: threadRef(ANALYSIS.threads[30]!, SOURCE, ANALYSIS.threads), text: 'Later' }]))
  act(() => select(null))
  expect(mounted()).toEqual([...range(0, 6), w(30)])
  act(() => setDrafts([]))
  expect(mounted()).toEqual(range(0, 6))
  // A focused card keeps its neighbors too, for keyboard order.
  act(() => focusDiscussion(span(20)))
  expect(mounted()).toEqual([...range(0, 6), w(19), w(20), w(21)])
  await act(() => scrollDocument(scroller(), 20_000))
  expect(mounted()).toEqual([w(19), w(20), w(21), ...range(37, 40)])
})

it('reveals a far card it mounts for a selection, as clicking its anchor does', async () => {
  act(() => root.render(<Harness />))
  expect(cardFor(w(30))).toBeUndefined()
  act(() => select(span(30)))
  await frames()
  const card = cardFor(w(30))!
  expect(card.style.top).toBe('15000px')
  expect(inView(card)).toBe(true)
  // The window followed the reveal; the card stayed where it was revealed.
  expect(mounted()).toContain(w(29))
  await frames()
  expect(inView(card)).toBe(true)
})

it('mounts a card whose comment Find reveals, then selects it and scrolls its match into view', async () => {
  const source = SOURCE.replace('comment 33', 'needle 33')
  act(() => root.render(<Harness initial={source} find />))
  expect(cardFor(w(33))).toBeUndefined()
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true })) })
  const input = host.querySelector<HTMLInputElement>('.find-input')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'needle')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await frames()
  const card = cardFor(w(33))!
  expect(card.classList.contains('active')).toBe(true)
  const [current] = highlights.get('find-current') ?? []
  expect(current && card.contains(current.startContainer)).toBe(true)
  expect(inView(card)).toBe(true)
})

it('mounts the neighbor past the window edge when focus reaches the first or last mounted card', async () => {
  act(() => root.render(<Harness />))
  await act(() => scrollDocument(scroller(), 10_000))
  expect(mounted()).toEqual(range(17, 26))
  // Tab follows DOM order, which is source order: the next card must follow the focused one.
  act(() => cardFor(w(25))!.querySelector<HTMLButtonElement>('.rail-select')!.focus())
  expect(mounted()).toEqual(range(17, 27))
  expect(cardFor(w(25))!.nextElementSibling).toBe(cardFor(w(26)))
  act(() => cardFor(w(17))!.querySelector<HTMLButtonElement>('.rail-select')!.focus())
  expect(mounted()).toEqual(range(16, 26))
  expect(cardFor(w(17))!.previousElementSibling).toBe(cardFor(w(16)))
})

it('calibrates estimates by measured cards and remembers heights after unmounting until they go stale', async () => {
  // Every anchor at the top: each card sits below the last, so later tops sum earlier heights.
  layout.anchorTop = () => 0
  act(() => root.render(<Harness />))
  // Unmounted cards of the same content are estimated at the 100 px their measured peers have.
  expect(cards().length).toBeLessThan(40)
  expect(parseFloat(host.querySelector<HTMLElement>('.rail')!.style.height)).toBeCloseTo(40 * 100 + 39 * GAP)
  heights.set(w(0), 300)
  resized(cardFor(w(0))!)
  const top = (i: number) => 300 + GAP + (i - 1) * (100 + GAP)
  await act(() => scrollDocument(scroller(), 3000))
  expect(mounted()).not.toContain(w(0))
  expect(topOf(w(20))).toBeCloseTo(top(20))

  // Unmounted, the first card keeps the height it was last measured at.
  heights.set(w(0), 50)
  documentResized()
  expect(topOf(w(20))).toBeCloseTo(top(20))

  // Selecting it measures it as selected; once it leaves again, that height is not kept.
  heights.set(w(0), 600)
  act(() => select(span(0)))
  expect(topOf(w(20))).toBeCloseTo(top(20) + 300)
  act(() => select(null))
  expect(mounted()).not.toContain(w(0))
  expect(topOf(w(20))).toBeCloseTo(20 * (100 + GAP))

  // Mounting measures it again.
  heights.set(w(0), 300)
  await act(() => scrollDocument(scroller(), 0))
  await act(() => scrollDocument(scroller(), 3000))
  expect(topOf(w(20))).toBeCloseTo(top(20))
  // A reply changes its content, so its remembered height goes.
  act(() => setSource(SOURCE.replace('comment 00<<}', 'comment 00<<}{>>@b: a reply<<}')))
  expect(topOf(w(20))).not.toBeCloseTo(top(20))
  act(() => setSource(SOURCE))
  await act(() => scrollDocument(scroller(), 0))
  await act(() => scrollDocument(scroller(), 3000))
  expect(topOf(w(20))).toBeCloseTo(top(20))
  // A new rail width rewraps every card, so unmounted cards' heights and the calibration go.
  railWidth = 200
  documentResized()
  expect(topOf(w(20))).not.toBeCloseTo(top(20))
})
