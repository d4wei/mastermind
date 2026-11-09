import { settledHeight } from './settling'

interface RailMeasurement {
  anchorTop: number
  height: number
  /** The height once sections now collapsing have closed; defaults to `height`. */
  settledHeight?: number
}

/**
 * Keep document order; selected cards can reclaim space above crowded anchors. Earlier cards make
 * that room by their settled heights, so a card collapsing above the selection is never pushed up
 * by height it is about to lose; the selection and later cards start below its current bottom and
 * rise frame by frame as it closes.
 */
export function placeCommentCards(cards: readonly RailMeasurement[], selected: number, gap: number): number[] {
  const tops: number[] = []
  let cursor = 0
  cards.forEach((card, index) => {
    tops[index] = Math.max(card.anchorTop, cursor)
    cursor = tops[index]! + card.height + gap
  })
  if (selected < 0 || selected >= cards.length) return tops

  // A growing card reserves only the height it has reached; a collapsing one only what it keeps.
  const reserved = cards.map((card) => Math.min(card.height, card.settledHeight ?? card.height))
  const minimumTops: number[] = []
  let minimum = 0
  reserved.forEach((height, index) => { minimumTops[index] = minimum; minimum += height + gap })
  // Earlier cards must still fit above the selection without leaving the document surface.
  tops[selected] = Math.max(cards[selected]!.anchorTop, minimumTops[selected]!)
  for (let i = selected - 1; i >= 0; i--) {
    tops[i] = Math.min(cards[i]!.anchorTop, tops[i + 1]! - reserved[i]! - gap)
    tops[i] = Math.max(minimumTops[i]!, tops[i]!)
  }
  // Current heights then keep every card clear of the one before it.
  for (let i = 1; i < cards.length; i++) {
    const clear = tops[i - 1]! + cards[i - 1]!.height + gap
    tops[i] = Math.max(i > selected ? cards[i]!.anchorTop : tops[i]!, clear)
  }
  return tops
}

/**
 * What `RailPlacement` reads from a card: its identity, its anchor's span index, and the content a
 * height estimate reads before the card has rendered.
 */
export interface PlacedCard {
  key: string
  spanIndex: number
  anchorText?: string
  thread: { comments: readonly { author?: string | null; body: string }[] }
}

interface CardSize {
  height: number
  settledHeight: number
}

/** How far beyond the viewport, in viewport heights each way, cards stay mounted. */
const WINDOW_MARGIN = 1.5

function measureCard(element: HTMLElement, height = element.getBoundingClientRect().height): CardSize {
  return { height, settledHeight: settledHeight(element, height) }
}

/** The border-box height an observation reports, measured where the browser reports none. */
function observedHeight(entry: ResizeObserverEntry): number {
  return entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
}

function setPixels(element: HTMLElement, property: 'top' | 'height' | 'paddingTop', value: number | null): void {
  const next = value === null ? '' : `${value}px`
  if (element.style[property] !== next) element.style[property] = next
}

/** What a card's unselected height depends on: its messages, their authors and bodies, and its passage. */
function contentOf(card: PlacedCard): string {
  let length = 0
  for (const comment of card.thread.comments) length += comment.body.length + (comment.author?.length ?? 0)
  return `${card.thread.comments.length}:${card.anchorText?.length ?? 0}:${length}`
}

/** The lengths of a comment body's paragraphs, as its display joins wrapped lines. */
function paragraphLengths(body: string): number[] {
  return body.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/).map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, ' ').length)
}

/** The card layout an estimate reads: line heights and characters per line, in pixels and characters. */
interface CardGeometry {
  /** Everything but the passage's lines and margins, the opening message's lines, and the reply count. */
  chrome: number
  passageLine: number
  passageChars: number
  passageMargins: number
  bodyLine: number
  bodyChars: number
  replies: number
}

/** Used until a rendered card supplies its geometry; calibration corrects its scale meanwhile. */
const DEFAULT_GEOMETRY: CardGeometry = { chrome: 60, passageLine: 15.4, passageChars: 45, passageMargins: 16,
  bodyLine: 19.6, bodyChars: 36, replies: 36 }
/** Prose whose average character width stands for a comment's. */
const SAMPLE_TEXT = 'Walks text with formatting source against splices and it offsets a cards review comment'

/**
 * Reads geometry from a laid-out card with a passage and a single message; null when the card
 * has another shape, is not laid out, or the browser cannot measure text.
 */
function measureGeometry(element: HTMLElement): CardGeometry | null {
  const passage = element.querySelector<HTMLElement>('.rail-card-anchor')
  const body = element.querySelector<HTMLElement>('.rail-body')
  if (!passage || !body || !passage.clientWidth || !body.clientWidth) return null
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  const passageStyle = getComputedStyle(passage), bodyStyle = getComputedStyle(body)
  const lineHeight = (style: CSSStyleDeclaration) => parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4
  const charWidth = (style: CSSStyleDeclaration) => {
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    return context.measureText(SAMPLE_TEXT).width / SAMPLE_TEXT.length
  }
  const passageMargins = (parseFloat(passageStyle.marginTop) || 0) + (parseFloat(passageStyle.marginBottom) || 0)
  // Wrapping breaks at words, so a line holds somewhat fewer characters than its width allows.
  const geometry: CardGeometry = {
    chrome: element.getBoundingClientRect().height - passage.getBoundingClientRect().height - passageMargins -
      body.getBoundingClientRect().height,
    passageLine: lineHeight(passageStyle), passageChars: Math.max(10, passage.clientWidth / charWidth(passageStyle) * 0.95),
    passageMargins, bodyLine: lineHeight(bodyStyle), bodyChars: Math.max(10, body.clientWidth / charWidth(bodyStyle) * 0.92),
    replies: DEFAULT_GEOMETRY.replies,
  }
  return Object.values(geometry).every(Number.isFinite) ? geometry : null
}

/**
 * Estimates the height of a card that has never rendered, from its content: chrome, the passage at
 * its two-line clamp, the opening message's wrapped lines, and the reply count when replies exist.
 * Geometry is read once from the first suitable rendered card; every estimate is then scaled by
 * the ratio of measured to estimated height over the unselected cards measured so far.
 */
export class CardHeightEstimator {
  private geometry = DEFAULT_GEOMETRY
  private geometryMeasured = false
  private raw = new WeakMap<PlacedCard, number>()
  private measured = 0
  private estimated = 0
  private ratio = 1

  estimate(card: PlacedCard): number {
    return this.rawEstimate(card) * this.ratio
  }

  /** Learns from an unselected card's first measurement; `element` may supply the geometry. */
  learn(card: PlacedCard, height: number, element?: HTMLElement): void {
    if (!this.geometryMeasured && element && card.thread.comments.length === 1) {
      const geometry = measureGeometry(element)
      if (geometry) { this.reset(); this.geometry = geometry; this.geometryMeasured = true }
    }
    this.measured += height
    this.estimated += this.rawEstimate(card)
    // The ratio moves only past a 2% drift, so a measurement that barely changes it does not move every unmounted card.
    const ratio = this.measured / this.estimated
    if (Number.isFinite(ratio) && ratio > 0 && Math.abs(ratio - this.ratio) > 0.02 * this.ratio) this.ratio = ratio
  }

  /** Forgets geometry and calibration, as when cards rewrap at a new width. */
  reset(): void {
    this.geometry = DEFAULT_GEOMETRY
    this.geometryMeasured = false
    this.raw = new WeakMap()
    this.measured = this.estimated = 0
    this.ratio = 1
  }

  private rawEstimate(card: PlacedCard): number {
    const cached = this.raw.get(card)
    if (cached !== undefined) return cached
    const geometry = this.geometry
    let height = geometry.chrome
    const passage = card.anchorText?.length ?? 0
    if (passage) height += geometry.passageMargins + Math.min(2, Math.ceil(passage / geometry.passageChars)) * geometry.passageLine
    const paragraphs = paragraphLengths(card.thread.comments[0]?.body ?? '')
    // Each paragraph break counts as one line.
    let lines = paragraphs.length - 1
    for (const length of paragraphs) lines += Math.max(1, Math.ceil(length / geometry.bodyChars))
    height += lines * geometry.bodyLine
    if (card.thread.comments.length > 1) height += geometry.replies
    this.raw.set(card, height)
    return height
  }
}

/**
 * Places a rail's cards beside their anchors by writing each mounted card's `top`, and the rail's
 * full height, to the elements themselves, so a re-placement renders nothing.
 *
 * Every card is placed, but inside a document scroller only the cards whose placed box meets the
 * viewport plus `WINDOW_MARGIN` are reported through `onWindow`; the rail mounts those (and any it
 * pins). A card's height is its measurement while mounted, the measurement it last had once it
 * unmounts, and an estimate until it first mounts; a remembered height is dropped when the card's
 * content, its selection, or the rail's width changes. Outside a document scroller, as in the narrow
 * comments panel, the rail flows on its own and `onWindow` reports every card.
 *
 * One observer watches the document and every mounted card while connected, and re-places
 * synchronously in its callback, which runs after layout and before paint: neighbors follow an
 * easing card in the same frame. An observation re-reads only what it reports: the cards that
 * resized, and anchor offsets only when the document resized, since anchors move only with it;
 * cards still settling also re-read their settled heights. `update` measures every mounted card and
 * anchor, for a new set of cards or a new selection; `afterRender` measures cards that just mounted.
 */
export class RailPlacement {
  private observer: ResizeObserver | null = null
  private readonly elements = new Map<string, HTMLElement>()
  private readonly keys = new Map<Element, string>()
  /** Each card's last measured size, kept after it unmounts. */
  private readonly sizes = new Map<string, CardSize>()
  /** The content each remembered size was measured with. */
  private readonly contents = new Map<string, string>()
  /** Cards mounted since placement last measured them. */
  private readonly unmeasured = new Set<string>()
  private readonly estimator = new CardHeightEstimator()
  private cards: readonly PlacedCard[] = []
  private index = new Map<string, number>()
  private selected: number | null = null
  private selectedKey: string | null = null
  private doc: HTMLElement | null = null
  private rail: HTMLElement | null = null
  private drafts: HTMLElement | null = null
  private scroller: HTMLElement | null = null
  /** The element each card's anchor span renders as, found once per set of cards and document. */
  private anchors = new Map<number, Element>()
  private anchorsFor: readonly PlacedCard[] | null = null
  private anchorTops = new Map<number, number>()
  private docHeight = 0
  private height = 0
  private width = 0
  private placedKeys: readonly string[] = []
  private placedFor: readonly PlacedCard[] | null = null
  /** The last placement's tops and the heights it used, in card order. */
  private tops: number[] = []
  private heights: number[] = []
  /** The keys last reported to `onWindow`; null reports every card. */
  private shown: ReadonlySet<string> | null = new Set()
  private frame = 0

  /**
   * `onPlaced` receives the keys of the placed cards whenever that set changes. `onWindow` receives
   * the keys of the cards near the viewport whenever they change, or null for every card; `urgent`
   * asks that they render before this frame paints, as when scrolling brings them in.
   */
  constructor(private readonly gap: number, private readonly onPlaced: (keys: readonly string[]) => void,
    private readonly onWindow: (keys: ReadonlySet<string> | null, urgent: boolean) => void) {}

  connect(): void {
    if (this.observer) return
    this.observer = new ResizeObserver((entries) => this.resized(entries))
    if (this.doc) this.observer.observe(this.doc)
    this.elements.forEach((element) => this.observer!.observe(element))
    this.listen(true)
  }

  disconnect(): void {
    this.observer?.disconnect()
    this.observer = null
    this.listen(false)
  }

  /** Tracks a card's element and gives it its placed top; returns its release, for a React ref callback. */
  attach(key: string, element: HTMLElement): () => void {
    this.elements.set(key, element)
    this.keys.set(element, key)
    this.observer?.observe(element)
    const index = this.index.get(key)
    if (index !== undefined && this.tops[index] !== undefined) setPixels(element, 'top', this.tops[index]!)
    this.unmeasured.add(key)
    return () => {
      this.observer?.unobserve(element)
      this.keys.delete(element)
      if (this.elements.get(key) !== element) return
      this.elements.delete(key)
      this.unmeasured.delete(key)
    }
  }

  element(key: string): HTMLElement | undefined {
    return this.elements.get(key)
  }

  /** Tracks the rail element, for a React ref callback; a rail outside a document scroller shows every card. */
  setRail(rail: HTMLElement | null): void {
    this.rail = rail
    const scroller = rail?.closest<HTMLElement>('.document-scroll') ?? null
    if (scroller !== this.scroller) {
      const listening = !!this.observer
      if (listening) this.listen(false)
      this.scroller = scroller
      if (listening) this.listen(true)
    }
    if (rail && !scroller) this.report(null, false)
    this.writeHeight()
  }

  /** Tracks the block of drafts whose discussions are gone, which follows the cards. */
  setDrafts(drafts: HTMLElement | null): void {
    this.drafts = drafts
    this.writeHeight()
  }

  /** Measures every mounted card and every anchor and places them; `selected` is the selected card's span index. */
  update(doc: HTMLElement | null, cards: readonly PlacedCard[], selected: number | null): void {
    if (doc !== this.doc) {
      if (this.doc) this.observer?.unobserve(this.doc)
      if (doc) this.observer?.observe(doc)
      this.doc = doc
      this.anchorsFor = null
    }
    if (cards !== this.anchorsFor) {
      this.anchorsFor = cards
      this.anchors = new Map()
      for (const element of doc?.querySelectorAll('[data-span-index]') ?? []) {
        const span = Number((element as HTMLElement).dataset.spanIndex)
        if (!this.anchors.has(span)) this.anchors.set(span, element)
      }
    }
    if (cards !== this.cards) this.setCards(cards)
    // A selection changes the height of the card it leaves and the card it reaches.
    const selectedKey = selected === null ? null : cards.find((card) => card.spanIndex === selected)?.key ?? null
    if (selectedKey !== this.selectedKey) {
      for (const key of [this.selectedKey, selectedKey]) if (key !== null && !this.elements.has(key)) this.sizes.delete(key)
      this.selectedKey = selectedKey
    }
    this.selected = selected
    if (!doc || !this.rail) return
    this.checkWidth()
    this.elements.forEach((element, key) => this.record(key, measureCard(element)))
    this.unmeasured.clear()
    this.measureAnchors()
    this.place()
    this.updateWindow(false)
  }

  /** Measures the cards mounted since the last measurement, before paint, and re-places if any differs. */
  afterRender(): void {
    if (!this.unmeasured.size || !this.doc || !this.rail) return
    let changed = false
    for (const key of this.unmeasured) {
      const element = this.elements.get(key)
      if (element && this.record(key, measureCard(element))) changed = true
    }
    this.unmeasured.clear()
    if (!changed) return
    this.place()
    this.updateWindow(false)
  }

  /** Drops remembered sizes whose card left or whose content changed. */
  private setCards(cards: readonly PlacedCard[]): void {
    this.cards = cards
    this.index = new Map(cards.map((card, i) => [card.key, i]))
    const live = new Set<string>()
    for (const card of cards) {
      live.add(card.key)
      const content = contentOf(card)
      if (this.contents.get(card.key) !== content) { this.sizes.delete(card.key); this.contents.set(card.key, content) }
    }
    for (const key of this.contents.keys()) if (!live.has(key)) { this.sizes.delete(key); this.contents.delete(key) }
  }

  /** Stores a measurement, learning from an unselected card's first; returns whether placement must change. */
  private record(key: string, size: CardSize): boolean {
    const index = this.index.get(key)
    const previous = this.sizes.get(key)
    if (!previous && index !== undefined && key !== this.selectedKey) {
      this.estimator.learn(this.cards[index]!, size.height, this.elements.get(key))
    }
    this.sizes.set(key, size)
    return index === undefined || Math.abs((this.heights[index] ?? -1) - size.height) > 0.5 ||
      previous?.settledHeight !== size.settledHeight
  }

  /** A narrower or wider rail rewraps every card, so unmounted cards' sizes and the estimate calibration go. */
  private checkWidth(): void {
    const width = this.rail!.clientWidth
    if (width === this.width) return
    if (this.width) {
      for (const key of this.sizes.keys()) if (!this.elements.has(key)) this.sizes.delete(key)
      this.estimator.reset()
    }
    this.width = width
  }

  private resized(entries: readonly ResizeObserverEntry[]): void {
    if (!this.doc || !this.rail) return
    let docResized = false
    const resizedCards = new Set<string>()
    for (const entry of entries) {
      if (entry.target === this.doc) { docResized = true; continue }
      const key = this.keys.get(entry.target)
      if (key === undefined) continue
      this.record(key, measureCard(entry.target as HTMLElement, observedHeight(entry)))
      this.unmeasured.delete(key)
      resizedCards.add(key)
    }
    this.elements.forEach((element, key) => {
      const size = this.sizes.get(key)
      if (size && !resizedCards.has(key) && size.settledHeight < size.height) this.sizes.set(key, measureCard(element, size.height))
    })
    if (docResized) {
      this.checkWidth()
      this.measureAnchors()
    }
    this.place()
    this.updateWindow(true)
  }

  private measureAnchors(): void {
    const railTop = this.rail!.getBoundingClientRect().top
    this.anchorTops = new Map(this.cards.map((card) => {
      const anchor = this.anchors.get(card.spanIndex)
      return [card.spanIndex, anchor ? Math.max(0, anchor.getBoundingClientRect().top - railTop) : 0]
    }))
    this.docHeight = this.doc!.scrollHeight
  }

  private place(): void {
    const measurements = this.cards.map((card) => {
      const size = this.sizes.get(card.key)
      return { anchorTop: this.anchorTops.get(card.spanIndex) ?? 0,
        height: size?.height ?? this.estimator.estimate(card), settledHeight: size?.settledHeight }
    })
    const tops = placeCommentCards(measurements, this.cards.findIndex((card) => card.spanIndex === this.selected), this.gap)
    this.tops = tops
    this.heights = measurements.map((measurement) => measurement.height)
    this.elements.forEach((element, key) => {
      const index = this.index.get(key)
      if (index !== undefined) setPixels(element, 'top', tops[index]!)
    })
    let bottom = this.docHeight
    tops.forEach((top, i) => { bottom = Math.max(bottom, top + this.heights[i]!) })
    this.height = bottom
    this.writeHeight()
    if (this.cards === this.placedFor) return
    this.placedFor = this.cards
    const keys = this.cards.map((card) => card.key)
    if (keys.length !== this.placedKeys.length || keys.some((key, i) => key !== this.placedKeys[i])) {
      this.placedKeys = keys
      this.onPlaced(keys)
    }
  }

  /** The drafts block sits below the rail's full height while there are cards to clear. */
  private writeHeight(): void {
    if (this.rail) setPixels(this.rail, 'height', this.height || null)
    if (this.drafts) setPixels(this.drafts, 'paddingTop', this.cards.length ? this.height : null)
  }

  private listen(on: boolean): void {
    const method = on ? 'addEventListener' : 'removeEventListener'
    this.scroller?.[method]('scroll', this.scrolled, { passive: true })
    window[method]('resize', this.scrolled)
    if (!on && this.frame) { cancelAnimationFrame(this.frame); this.frame = 0 }
  }

  /** Scrolling and viewport resizes move the window once per frame. */
  private readonly scrolled = (): void => {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.updateWindow(true) })
  }

  /** Reports the cards whose placed box meets the viewport plus `WINDOW_MARGIN` viewports each way. */
  private updateWindow(urgent: boolean): void {
    const scroller = this.scroller
    if (!scroller || !this.rail) return
    const railTop = this.rail.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    const margin = scroller.clientHeight * WINDOW_MARGIN
    const from = scroller.scrollTop - railTop - margin
    const to = scroller.scrollTop - railTop + scroller.clientHeight + margin
    // Placement keeps source order without overlap, so tops and bottoms both ascend.
    let first = 0, end = this.tops.length
    while (first < end) {
      const middle = (first + end) >> 1
      if (this.tops[middle]! + this.heights[middle]! < from) first = middle + 1
      else end = middle
    }
    const keys = new Set<string>()
    for (let i = first; i < this.tops.length && this.tops[i]! <= to; i++) keys.add(this.cards[i]!.key)
    this.report(keys, urgent)
  }

  private report(keys: ReadonlySet<string> | null, urgent: boolean): void {
    const shown = this.shown
    if (keys === shown || (keys && shown && keys.size === shown.size && [...keys].every((key) => shown.has(key)))) return
    this.shown = keys
    this.onWindow(keys, urgent)
  }
}
