import { commentSearchText } from './CommentBody'
import { cssMs } from '../util/css-tokens'
import { SETTLES_TO, settledHeight } from './settling'

/** One card as placement sees it, in rail coordinates. */
export interface RailMeasurement {
  /** The top of the card's passage. */
  anchorTop: number
  /** From the card's top to the top of its opening message's body. */
  bodyOffset: number
  height: number
  /** The height once sections now collapsing have closed; defaults to `height`. */
  settledHeight?: number
}

/** Where a card's opening message's body meets the top of its passage, never above the rail's top. */
export function alignedTop(card: RailMeasurement): number {
  return Math.max(0, card.anchorTop - card.bodyOffset)
}

/**
 * Keeps document order without overlap, around `pivot`, the card most recently selected (-1 for
 * none). Without a pivot, each card takes its aligned top or sits one gap below the card before it,
 * whichever is lower. The pivot takes its aligned top unless earlier cards would not fit above it
 * within the rail; earlier cards stack upward from it, each as close to its own aligned top as order
 * allows, and later cards stack downward. Earlier cards make room by their settled heights, so a
 * card collapsing above the pivot is never pushed up by height it is about to lose; current heights
 * then keep every card clear of the one before it.
 */
export function placeCommentCards(cards: readonly RailMeasurement[], pivot: number, gap: number): number[] {
  const tops: number[] = []
  let cursor = 0
  cards.forEach((card, index) => {
    tops[index] = Math.max(alignedTop(card), cursor)
    cursor = tops[index]! + card.height + gap
  })
  if (pivot < 0 || pivot >= cards.length) return tops

  // A growing card reserves only the height it has reached; a collapsing one only what it keeps.
  const reserved = cards.map((card) => Math.min(card.height, card.settledHeight ?? card.height))
  const minimumTops: number[] = []
  let minimum = 0
  reserved.forEach((height, index) => { minimumTops[index] = minimum; minimum += height + gap })
  tops[pivot] = Math.max(alignedTop(cards[pivot]!), minimumTops[pivot]!)
  for (let i = pivot - 1; i >= 0; i--) {
    tops[i] = Math.max(minimumTops[i]!, Math.min(alignedTop(cards[i]!), tops[i + 1]! - reserved[i]! - gap))
  }
  for (let i = 1; i < cards.length; i++) {
    const clear = tops[i - 1]! + cards[i - 1]!.height + gap
    tops[i] = Math.max(i > pivot ? alignedTop(cards[i]!) : tops[i]!, clear)
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
  /** Undefined while the passage is drawn past its clamp. */
  bodyOffset?: number
}

/** How far beyond the viewport, in viewport heights each way, cards stay mounted. */
const WINDOW_MARGIN = 1.5

/**
 * The distance from a card's top to its opening message's body. A passage expanded past its clamp,
 * or easing back to it, gives none: a card keeps the offset its clamp gives, so an expanding passage
 * grows the card downward.
 */
function bodyOffsetOf(element: HTMLElement): number | undefined {
  const body = element.querySelector<HTMLElement>('.rail-body')
  if (!body) return undefined
  const passage = element.querySelector<HTMLElement>('.rail-card-anchor')
  if (passage && (passage.classList.contains('expanded') || passage.hasAttribute(SETTLES_TO))) return undefined
  return body.getBoundingClientRect().top - element.getBoundingClientRect().top
}

function measureCard(element: HTMLElement, height = element.getBoundingClientRect().height): CardSize {
  return { height, settledHeight: settledHeight(element, height), bodyOffset: bodyOffsetOf(element) }
}

/** The border-box height an observation reports, measured where the browser reports none. */
function observedHeight(entry: ResizeObserverEntry): number {
  return entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
}

/** The space below the last card where no styles apply to the rail, as in jsdom. */
const END_SPACE_FALLBACK = 40

/** How a re-placement moves cards on screen; null moves them at once. */
interface Motion {
  duration: number
  easing: string
}

/** A move shorter than this, in pixels, happens at once. */
const MIN_MOVE = 1

/** The vertical offset a running transform draws `element` at. */
function drawnOffset(element: HTMLElement): number {
  const match = /^matrix(3d)?\((.*)\)$/.exec(getComputedStyle(element).transform)
  if (!match) return 0
  return parseFloat(match[2]!.split(',')[match[1] ? 13 : 5]!) || 0
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

/** The lengths of a comment body's paragraphs as `CommentBody` displays them. */
function paragraphLengths(body: string): number[] {
  return commentSearchText(body).split('\n\n').map((paragraph) => paragraph.length)
}

/** The card layout an estimate reads: lengths in pixels, and characters per line. */
interface CardGeometry {
  /** From the card's top to its author row's bottom: border, padding, and the row. */
  head: number
  /** Between the author row and the opening message's body besides the passage's lines. */
  quoteGap: number
  /** Between the author row and the opening message's body on a card without a passage. */
  plainGap: number
  /** From the opening message's body to the card's bottom: padding and border. */
  tail: number
  passageLine: number
  passageChars: number
  bodyLine: number
  bodyChars: number
  replies: number
}

/** Used until a rendered card supplies its geometry; calibration corrects its scale meanwhile. */
const DEFAULT_GEOMETRY: CardGeometry = { head: 41, quoteGap: 16, plainGap: 4, tail: 13, passageLine: 15.4,
  passageChars: 45, bodyLine: 19.6, bodyChars: 36, replies: 36 }
/** Prose whose average character width stands for a comment's. */
const SAMPLE_TEXT = 'Walks text with formatting source against splices and it offsets a cards review comment'

/**
 * Reads geometry from a laid-out card with a passage and a single message; null when the card
 * has another shape, is not laid out, or the browser cannot measure text.
 */
function measureGeometry(element: HTMLElement): CardGeometry | null {
  const header = element.querySelector<HTMLElement>('.rail-message-header')
  const passage = element.querySelector<HTMLElement>('.rail-card-anchor')
  const body = element.querySelector<HTMLElement>('.rail-body')
  if (!header || !passage || !body || !passage.clientWidth || !body.clientWidth) return null
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  const passageStyle = getComputedStyle(passage), bodyStyle = getComputedStyle(body)
  const lineHeight = (style: CSSStyleDeclaration) => parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4
  const charWidth = (style: CSSStyleDeclaration) => {
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    return context.measureText(SAMPLE_TEXT).width / SAMPLE_TEXT.length
  }
  const card = element.getBoundingClientRect(), headerBox = header.getBoundingClientRect()
  const bodyBox = body.getBoundingClientRect()
  // Without a passage, the author row's bottom margin collapses with the body's top margin.
  const plainGap = Math.max(parseFloat(getComputedStyle(header).marginBottom) || 0, parseFloat(bodyStyle.marginTop) || 0)
  // Wrapping breaks at words, so a line holds somewhat fewer characters than its width allows.
  const geometry: CardGeometry = {
    head: headerBox.bottom - card.top, quoteGap: bodyBox.top - headerBox.bottom - passage.getBoundingClientRect().height,
    plainGap, tail: card.bottom - bodyBox.bottom,
    passageLine: lineHeight(passageStyle), passageChars: Math.max(10, passage.clientWidth / charWidth(passageStyle) * 0.95),
    bodyLine: lineHeight(bodyStyle), bodyChars: Math.max(10, body.clientWidth / charWidth(bodyStyle) * 0.92),
    replies: DEFAULT_GEOMETRY.replies,
  }
  return Object.values(geometry).every(Number.isFinite) ? geometry : null
}

/** A running ratio of measured to estimated sizes, moved only past a 2% drift. */
class Calibration {
  private measured = 0
  private estimated = 0
  ratio = 1

  learn(measured: number, estimated: number): void {
    this.measured += measured
    this.estimated += estimated
    // A measurement that barely changes the ratio leaves it, so it does not move every unmounted card.
    const ratio = this.measured / this.estimated
    if (Number.isFinite(ratio) && ratio > 0 && Math.abs(ratio - this.ratio) > 0.02 * this.ratio) this.ratio = ratio
  }
}

/**
 * Estimates a card that has never rendered from its content: its height (the author row, the
 * passage at its two-line clamp, the opening message's wrapped lines, and the reply count when
 * replies exist) and its body offset (the same geometry down to the opening message's body).
 * Geometry is read once from the first suitable rendered card; each estimate is then scaled by the
 * ratio of measured to estimated sizes over the unselected cards measured so far.
 */
export class CardHeightEstimator {
  private geometry = DEFAULT_GEOMETRY
  private geometryMeasured = false
  private raw = new WeakMap<PlacedCard, { height: number; bodyOffset: number }>()
  private heights = new Calibration()
  private offsets = new Calibration()

  estimate(card: PlacedCard): number {
    return this.rawEstimate(card).height * this.heights.ratio
  }

  bodyOffset(card: PlacedCard): number {
    return this.rawEstimate(card).bodyOffset * this.offsets.ratio
  }

  /** Learns from an unselected card's first measurement; `element` may supply the geometry. */
  learn(card: PlacedCard, height: number, element?: HTMLElement, bodyOffset?: number): void {
    if (!this.geometryMeasured && element && card.thread.comments.length === 1) {
      const geometry = measureGeometry(element)
      if (geometry) { this.reset(); this.geometry = geometry; this.geometryMeasured = true }
    }
    const raw = this.rawEstimate(card)
    this.heights.learn(height, raw.height)
    if (bodyOffset !== undefined) this.offsets.learn(bodyOffset, raw.bodyOffset)
  }

  /** Forgets geometry and calibration, as when cards rewrap at a new width. */
  reset(): void {
    this.geometry = DEFAULT_GEOMETRY
    this.geometryMeasured = false
    this.raw = new WeakMap()
    this.heights = new Calibration()
    this.offsets = new Calibration()
  }

  private rawEstimate(card: PlacedCard): { height: number; bodyOffset: number } {
    const cached = this.raw.get(card)
    if (cached) return cached
    const geometry = this.geometry
    const passage = card.anchorText?.length ?? 0
    const bodyOffset = geometry.head + (passage
      ? geometry.quoteGap + Math.min(2, Math.ceil(passage / geometry.passageChars)) * geometry.passageLine
      : geometry.plainGap)
    const paragraphs = paragraphLengths(card.thread.comments[0]?.body ?? '')
    // Each paragraph break counts as one line.
    let lines = paragraphs.length - 1
    for (const length of paragraphs) lines += Math.max(1, Math.ceil(length / geometry.bodyChars))
    let height = bodyOffset + lines * geometry.bodyLine + geometry.tail
    if (card.thread.comments.length > 1) height += geometry.replies
    const estimate = { height, bodyOffset }
    this.raw.set(card, estimate)
    return estimate
  }
}

/**
 * Places a rail's cards beside their anchors by writing each mounted card's `top`, and the rail's
 * full height, to the elements themselves, so a re-placement renders nothing.
 *
 * Every card is placed, but inside a document scroller only the cards whose placed box meets the
 * viewport plus `WINDOW_MARGIN` are reported through `onWindow`; the rail mounts those (and any it
 * pins). A card's height and body offset are its measurements while mounted, the measurements it
 * last had once it unmounts, and estimates until it first mounts; a remembered height is dropped
 * when the card's content, its selection, or the rail's width changes. Outside a document scroller,
 * as in the narrow comments panel, the rail flows on its own and `onWindow` reports every card.
 *
 * The pivot is the card most recently selected; it stays the pivot after deselection, until another
 * card is selected or its discussion leaves the cards.
 *
 * One observer watches the document and every mounted card while connected, and re-places
 * synchronously in its callback, which runs after layout and before paint: neighbors follow an
 * easing card in the same frame. An observation re-reads only what it reports: the cards that
 * resized, and anchor offsets only when the document resized, since anchors move only with it;
 * cards still settling also re-read their settled heights. `update` measures every mounted card and
 * anchor, for a new set of cards or a new selection; `afterRender` measures cards that just mounted.
 *
 * Only a selection change animates. The cards it changes (the card it reaches and the card it
 * leaves) are placed by the heights their sections settle at until they reach them, so placement
 * holds still while they ease, and each mounted card it moves keeps its new `top` at once, so
 * layout and the window stay exact, while a transform plays from where the card was drawn back to
 * zero over the sections' own duration and curve. Every other re-placement follows something
 * already moving frame by frame, or corrects a card nobody has seen settle, so it moves at once.
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
  /** Cards a selection change resized, placed by their settled heights until they reach them. */
  private settling = new Set<string>()
  private readonly estimator = new CardHeightEstimator()
  private cards: readonly PlacedCard[] = []
  private index = new Map<string, number>()
  private selectedKey: string | null = null
  private pivotKey: string | null = null
  private doc: HTMLElement | null = null
  private rail: HTMLElement | null = null
  private drafts: HTMLElement | null = null
  private scroller: HTMLElement | null = null
  /** The element each card's anchor span renders as, found once per set of cards and document. */
  private anchors = new Map<number, Element>()
  private anchorsFor: readonly PlacedCard[] | null = null
  /** Each anchor's top, by span index. */
  private passages = new Map<number, number>()
  /** The rail's top within the scroller's content, read with the anchors. */
  private railOffset = 0
  private docBottom = 0
  /** Read from the rail's bottom padding, which the document column's bottom padding shares. */
  private endSpace = END_SPACE_FALLBACK
  /** The move each card is still playing, if any. */
  private readonly moves = new WeakMap<HTMLElement, Animation>()
  private height = 0
  private width = 0
  private placedKeys: readonly string[] = []
  private placedFor: readonly PlacedCard[] | null = null
  /** The last placement's tops, and the heights and body offsets it used, in card order. */
  private tops: number[] = []
  private heights: number[] = []
  private offsets: number[] = []
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
      this.settling.delete(key)
      // A card unmounting mid-ease is remembered at the height it was settling to.
      const size = this.sizes.get(key)
      if (size && size.settledHeight !== size.height) this.sizes.set(key, { ...size, height: size.settledHeight })
    }
  }

  element(key: string): HTMLElement | undefined {
    return this.elements.get(key)
  }

  /** How far a running move draws the card below its placed top. */
  drawnOffset(key: string): number {
    const element = this.elements.get(key)
    return element && this.moves.has(element) ? drawnOffset(element) : 0
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
    if (rail) {
      // A browser computes padding in pixels; any other reading means no styles applied.
      const space = getComputedStyle(rail).paddingBottom
      this.endSpace = space.endsWith('px') ? parseFloat(space) : END_SPACE_FALLBACK
    }
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
    const selecting = selectedKey !== this.selectedKey
    if (selecting) {
      const changed = [this.selectedKey, selectedKey].filter((key): key is string => key !== null)
      for (const key of changed) if (!this.elements.has(key)) this.sizes.delete(key)
      this.settling = new Set(changed.filter((key) => this.elements.has(key)))
      this.selectedKey = selectedKey
      if (selectedKey !== null) this.pivotKey = selectedKey
    }
    if (!doc || !this.rail) return
    this.checkWidth()
    this.elements.forEach((element, key) => this.record(key, measureCard(element)))
    // Cards mounted in this commit were never drawn where placement last put them.
    const mounting = new Set(this.unmeasured)
    this.unmeasured.clear()
    this.measureAnchors()
    this.place(selecting ? mounting : null)
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

  /** Drops remembered sizes whose card left or whose content changed, and a pivot whose card left. */
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
    if (this.pivotKey !== null && !live.has(this.pivotKey)) this.pivotKey = null
  }

  /** Stores a measurement, learning from an unselected card's first; returns whether placement must change. */
  private record(key: string, size: CardSize): boolean {
    const index = this.index.get(key)
    const previous = this.sizes.get(key)
    if (size.bodyOffset === undefined) size.bodyOffset = previous?.bodyOffset
    if (!previous && index !== undefined && key !== this.selectedKey) {
      this.estimator.learn(this.cards[index]!, size.height, this.elements.get(key), size.bodyOffset)
    }
    this.sizes.set(key, size)
    // A card a selection resized follows its own sections again once it reaches its settled height.
    if (this.settling.has(key) && Math.abs(size.settledHeight - size.height) < 0.5) this.settling.delete(key)
    return index === undefined || Math.abs((this.heights[index] ?? -1) - size.height) > 0.5 ||
      previous?.settledHeight !== size.settledHeight ||
      (size.bodyOffset !== undefined && Math.abs((this.offsets[index] ?? -1) - size.bodyOffset) > 0.5)
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
      if (size && !resizedCards.has(key) && size.settledHeight !== size.height) this.record(key, measureCard(element, size.height))
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
    // The rail's offset within the scroller's content moves only with the document, so the window
    // reads it here rather than forcing a layout after each placement.
    const scroller = this.scroller
    if (scroller) this.railOffset = railTop - scroller.getBoundingClientRect().top + scroller.scrollTop
    this.passages = new Map(this.cards.map((card) => {
      const anchor = this.anchors.get(card.spanIndex)
      return [card.spanIndex, anchor ? Math.max(0, anchor.getBoundingClientRect().top - railTop) : 0]
    }))
    this.docBottom = this.doc!.getBoundingClientRect().bottom - railTop
  }

  /**
   * Places every card and writes the mounted cards' tops. `moving` is null for a re-placement that
   * moves cards at once; otherwise it lists the mounted cards that have no drawn position to move from.
   */
  private place(moving: ReadonlySet<string> | null = null): void {
    const measurements = this.cards.map((card): RailMeasurement => {
      const size = this.sizes.get(card.key)
      const bodyOffset = size?.bodyOffset ?? this.estimator.bodyOffset(card)
      const anchorTop = this.passages.get(card.spanIndex) ?? 0
      if (!size) return { anchorTop, bodyOffset, height: this.estimator.estimate(card) }
      const height = this.settling.has(card.key) ? size.settledHeight : size.height
      return { anchorTop, bodyOffset, height, settledHeight: size.settledHeight }
    })
    const pivot = this.pivotKey === null ? -1 : this.index.get(this.pivotKey) ?? -1
    const tops = placeCommentCards(measurements, pivot, this.gap)
    this.tops = tops
    this.heights = measurements.map((measurement) => measurement.height)
    this.offsets = measurements.map((measurement) => measurement.bodyOffset)
    const motion = moving && this.motion()
    this.elements.forEach((element, key) => {
      const index = this.index.get(key)
      if (index === undefined) return
      if (motion && !moving!.has(key)) this.move(element, tops[index]!, motion)
      setPixels(element, 'top', tops[index]!)
    })
    // Cards past the document's end leave the same space below them as the document column does.
    let bottom = 0
    tops.forEach((top, i) => { bottom = Math.max(bottom, top + this.heights[i]!) })
    this.height = Math.max(this.docBottom, bottom + (tops.length ? this.endSpace : 0))
    this.writeHeight()
    if (this.cards === this.placedFor) return
    this.placedFor = this.cards
    const keys = this.cards.map((card) => card.key)
    if (keys.length !== this.placedKeys.length || keys.some((key, i) => key !== this.placedKeys[i])) {
      this.placedKeys = keys
      this.onPlaced(keys)
    }
  }

  /** The rail's move timing, which the theme ties to its sections' easing; null where moves are instant, as under reduced motion. */
  private motion(): Motion | null {
    if (!this.rail) return null
    const style = getComputedStyle(this.rail)
    const duration = cssMs(style, '--rail-card-move') ?? 0
    return duration > 0 ? { duration, easing: style.getPropertyValue('--ease-standard').trim() || 'ease' } : null
  }

  /** Plays `element` from where it is drawn now to `top`, which the caller writes at once. */
  private move(element: HTMLElement, top: number, motion: Motion): void {
    const from = parseFloat(element.style.top)
    if (typeof element.animate !== 'function' || !Number.isFinite(from)) return
    const running = this.moves.get(element)
    // An interrupted move starts from its current drawn position.
    const drawn = from + (running ? drawnOffset(element) : 0)
    if (Math.abs(drawn - top) < MIN_MOVE && Math.abs(from - top) < MIN_MOVE) return
    running?.cancel()
    this.moves.delete(element)
    if (Math.abs(drawn - top) < MIN_MOVE) return
    const animation = element.animate([{ transform: `translateY(${drawn - top}px)` }, { transform: 'none' }], motion)
    this.moves.set(element, animation)
    animation.onfinish = () => { if (this.moves.get(element) === animation) this.moves.delete(element) }
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
    const margin = scroller.clientHeight * WINDOW_MARGIN
    const from = scroller.scrollTop - this.railOffset - margin
    const to = scroller.scrollTop - this.railOffset + scroller.clientHeight + margin
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
