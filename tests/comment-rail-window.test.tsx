// @vitest-environment jsdom
import { act, useMemo, useRef, useState, type RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
/** The rail's space below its last card where no styles apply, as here. */
const END_SPACE = 40
/** How far below a card's top its opening message's body starts. */
const BODY = 40

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
  layout = { viewport: 1000, documentHeight: 500 * 39 + 20, anchorTop: (anchor) => 500 * marks().indexOf(anchor),
    cardHeight: (card) => heights.get(passageOf(card)) ?? 100, bodyOffset: () => BODY,
    // A card's height stands for its sections' too, so they add nothing to it as they open or close.
    innerHeight: (element) => element.matches('.collapsible, [data-settles-content]') ? 0 : undefined }
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
function passageOf(card: HTMLElement): string { return card.querySelector('.rail-card-anchor')?.textContent ?? '' }
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
const railHeight = () => parseFloat(host.querySelector<HTMLElement>('.rail')!.style.height)

it('mounts only the cards near the viewport and keeps the rail its full height', async () => {
  act(() => root.render(<Harness />))
  // Cards up to 2,500 px fall within the viewport and its margin; each body meets its passage.
  expect(mounted()).toEqual(range(0, 6))
  expect(cardFor(w(5))!.style.top).toBe(`${2500 - BODY}px`)
  // The last card passes the document's end, so the rail leaves space below it.
  expect(railHeight()).toBeCloseTo(500 * 39 - BODY + 100 + END_SPACE)
  await act(() => scrollDocument(scroller(), 10_000))
  // 8,500 to 12,500 px, counting the cards whose box reaches 8,500.
  expect(mounted()).toEqual(range(17, 26))
  expect(cardFor(w(20))!.style.top).toBe(`${10_000 - BODY}px`)
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
  // Its body meets its passage at 15,000 px.
  expect(card.style.top).toBe(`${15_000 - BODY}px`)
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
  layout.documentHeight = 20
  act(() => root.render(<Harness />))
  // Unmounted cards of the same content are estimated at the 100 px their measured peers have.
  expect(cards().length).toBeLessThan(40)
  expect(railHeight()).toBeCloseTo(40 * 100 + 39 * GAP + END_SPACE)
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

it('remembers a card that unmounts mid-collapse at the height it is settling to', async () => {
  layout.anchorTop = () => 0
  act(() => root.render(<Harness />))
  heights.set(w(0), 300)
  // A section of the first card is closing to nothing: the 20 px it measures are leaving.
  cardFor(w(0))!.querySelector('.rail-body')!.setAttribute('data-settles-to', '0')
  resized(cardFor(w(0))!)
  const top = (first: number, i: number) => first + GAP + (i - 1) * (100 + GAP)
  expect(topOf(w(20))).toBeCloseTo(top(300, 20))
  await act(() => scrollDocument(scroller(), 3000))
  expect(mounted()).not.toContain(w(0))
  documentResized()
  expect(topOf(w(20))).toBeCloseTo(top(280, 20))
})

it('keeps the document\'s height while the cards end above it, and leaves space below them once they pass it', () => {
  layout.documentHeight = 30_000
  act(() => root.render(<Harness />))
  const rail = host.querySelector<HTMLElement>('.rail')!
  expect(rail.style.height).toBe('30000px')
  layout.documentHeight = 19_590
  documentResized()
  expect(railHeight()).toBeCloseTo(500 * 39 - BODY + 100 + END_SPACE)
})

describe('the pivot', () => {
  /** Anchors 100 px apart from 1,000 px: each 100 px card crowds the next. */
  const crowd = () => { layout.anchorTop = (anchor) => 1000 + 100 * marks().indexOf(anchor) }

  it('aligns the selected card in a crowd and keeps it there after deselection', () => {
    crowd()
    act(() => root.render(<Harness />))
    // Without a pivot, cards stack down from the first.
    expect(range(0, 5).map(topOf)).toEqual([960, 1068, 1176, 1284, 1392])
    act(() => select(span(3)))
    expect(range(0, 5).map(topOf)).toEqual([936, 1044, 1152, 1260, 1368])
    act(() => select(null))
    expect(range(0, 5).map(topOf)).toEqual([936, 1044, 1152, 1260, 1368])
  })

  it('moves to a new selection and is dropped when its discussion disappears', () => {
    crowd()
    act(() => root.render(<Harness />))
    act(() => select(span(3)))
    act(() => select(span(1)))
    expect(range(0, 5).map(topOf)).toEqual([952, 1060, 1168, 1276, 1384])
    act(() => select(null))
    // A source change that removes the pivot's discussion leaves the cards stacked in order again.
    act(() => setSource(SOURCE.replace('Paragraph {==w01==}{>>@a: comment 01<<}', 'Paragraph w01')))
    expect(mounted()).not.toContain(w(1))
    expect(topOf(w(0))).toBe(960)
    expect(topOf(w(2))).toBe(1068)
  })
})

/** Each move a card started: the card, the transform it starts from, and its animation. */
let moves: { card: string; from: string; animation: { cancel: () => void; onfinish: null } }[]
/**
 * Gives the rail its move duration and the sections theirs, and records moves through a stubbed
 * `animate`. Unless `instantSections`, reduced motion is off, so sections ease until their
 * transition is ended by hand; with it, sections and reveals change at once while cards still move.
 */
function enableMotion(duration = '180ms', instantSections = false) {
  if (!instantSections) vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const style = document.createElement('style')
  style.textContent = `.rail { --rail-card-move: ${duration}; --ease-standard: linear; }`
  document.head.append(style)
  document.documentElement.style.setProperty('--dur-base', duration)
  moves = []
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value(this: HTMLElement, keyframes: Keyframe[]) {
    const animation = { cancel: vi.fn(), onfinish: null }
    moves.push({ card: passageOf(this), from: String(keyframes[0]!.transform), animation })
    return animation
  } })
  return () => {
    style.remove()
    document.documentElement.style.removeProperty('--dur-base')
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  }
}
const moved = () => moves.map(({ card, from }) => [card, from])
/**
 * One card's easing sections, as layout reports them mid-ease: each moving section's row is
 * `drawn` tall while its content is `full` tall.
 */
let easing: { passage: string; drawn: number; full: number } | null
function easeSections() {
  easing = null
  const still = layout.innerHeight!
  layout.innerHeight = (element, card) => {
    if (!easing || passageOf(card) !== easing.passage) return still(element, card)
    if (element.matches('.collapsible[data-settles-to]')) return easing.drawn
    if (element.matches('[data-settles-content]')) return easing.full
    return still(element, card)
  }
}
/** Ends every section's row transition in `card`, as the browser reports it. */
function endTransitions(card: HTMLElement) {
  for (const section of card.querySelectorAll('.collapsible')) {
    const event = new Event('transitionend')
    Object.defineProperty(event, 'propertyName', { value: 'grid-template-rows' })
    act(() => { section.dispatchEvent(event) })
  }
}

describe('motion', () => {
  it('plays one move per card a selection pushes, toward a placement by settled heights, and none while it eases', () => {
    const restore = enableMotion()
    easeSections()
    try {
      act(() => root.render(<Harness />))
      expect(moves).toEqual([])
      // The composer opens to 450 px; at the selection it has not grown yet.
      easing = { passage: w(1), drawn: 0, full: 450 }
      act(() => select(span(1)))
      // The selected card keeps its top; the next card clears its settled 550 px at once.
      expect(topOf(w(1))).toBe(500 - BODY)
      expect(topOf(w(2))).toBe(460 + 550 + GAP)
      expect(topOf(w(3))).toBe(1500 - BODY)
      expect(moved()).toEqual([[w(2), `translateY(${960 - 1018}px)`]])
      // Frame by frame, the card grows; nothing re-aims.
      for (const drawn of [150, 300, 450]) {
        easing = { passage: w(1), drawn, full: 450 }
        heights.set(w(1), 100 + drawn)
        resized(cardFor(w(1))!)
        expect(topOf(w(2))).toBe(1018)
      }
      expect(moves).toHaveLength(1)
      endTransitions(cardFor(w(1))!)
      easing = null
      // A change with no selection change, as a reply field growing, moves at once.
      heights.set(w(1), 600)
      resized(cardFor(w(1))!)
      expect(topOf(w(2))).toBe(460 + 600 + GAP)
      expect(moves).toHaveLength(1)
    } finally { restore() }
  })

  it('leaves the pivot in place on deselection and moves only what its shrinking releases, from where it is drawn', () => {
    const restore = enableMotion()
    easeSections()
    try {
      act(() => root.render(<Harness />))
      heights.set(w(1), 600)
      act(() => select(span(1)))
      endTransitions(cardFor(w(1))!)
      expect(topOf(w(2))).toBe(1068)
      // The next card is still drawn 30 px below its top by its move.
      cardFor(w(2))!.style.transform = 'matrix(1, 0, 0, 1, 0, 30)'
      const running = moves.find(({ card }) => card === w(2))!.animation
      moves = []
      // The composer closes from 450 px to nothing.
      easing = { passage: w(1), drawn: 450, full: 450 }
      act(() => select(null))
      expect(running.cancel).toHaveBeenCalled()
      expect(topOf(w(1))).toBe(460)
      expect(topOf(w(2))).toBe(960)
      expect(moved()).toEqual([[w(2), `translateY(${1068 + 30 - 960}px)`]])
    } finally { restore() }
  })

  it('moves a card less than a pixel at once', () => {
    const restore = enableMotion()
    easeSections()
    try {
      act(() => root.render(<Harness />))
      easing = { passage: w(1), drawn: 0, full: 392.5 }
      act(() => select(span(1)))
      expect(topOf(w(2))).toBe(960.5)
      expect(moves).toEqual([])
    } finally { restore() }
  })

  it('moves cards at once when the size observer, the document, a mounting card, or new cards re-place them', async () => {
    const restore = enableMotion()
    try {
      act(() => root.render(<Harness />))
      heights.set(w(0), 600)
      resized(cardFor(w(0))!)
      expect(topOf(w(1))).toBe(608)
      layout.anchorTop = (anchor) => 600 * marks().indexOf(anchor)
      documentResized()
      expect(topOf(w(2))).toBe(1200 - BODY)
      act(() => setSource(SOURCE.replace('comment 00<<}', 'comment 00<<}{>>@b: a reply<<}')))
      act(() => setSource(SOURCE))
      await act(() => scrollDocument(scroller(), 10_000))
      // A far card mounting for its selection has nowhere it was drawn to move from.
      act(() => select(span(30)))
      expect(cardFor(w(30))).toBeDefined()
      expect(moves).toEqual([])
    } finally { restore() }
  })

  it('moves cards at once under reduced motion and where animations are unavailable', () => {
    const restoreReduced = enableMotion('0s')
    easeSections()
    try {
      act(() => root.render(<Harness />))
      heights.set(w(1), 1200)
      act(() => select(span(1)))
      expect(topOf(w(2))).toBe(460 + 1200 + GAP)
      expect(moves).toEqual([])
    } finally { restoreReduced() }
    const restore = enableMotion()
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    try {
      heights.set(w(1), 100)
      act(() => select(span(3)))
      expect(topOf(w(2))).toBe(1000 - BODY)
    } finally { restore() }
  })

  it('reveals a selected card where it is placed, not where its move still draws it', async () => {
    const restore = enableMotion('180ms', true)
    try {
      const anchors = [0, 700, 710, 720, 730, 760]
      layout.anchorTop = (anchor) => anchors[marks().indexOf(anchor)] ?? 5000
      act(() => root.render(<Harness />))
      // The sixth card stacks below a crowd; selected, it takes its own alignment and moves up.
      expect(topOf(w(5))).toBe(1092)
      act(() => select(span(5)))
      expect(topOf(w(5))).toBe(760 - BODY)
      expect(moves.find(({ card }) => card === w(5))?.from).toBe(`translateY(${1092 - 720}px)`)
      cardFor(w(5))!.style.transform = 'matrix(1, 0, 0, 1, 0, 372)'
      layout.viewport = 300
      await frames()
      // The composer's 20 px at its placed top end at the viewport's bottom.
      expect(scroller().scrollTop).toBe(720 + 20 - 300)
    } finally { restore() }
  })
})
