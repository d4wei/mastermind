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

/** A card as `RailPlacement` places it: its identity and the span index of its anchor. */
interface PlacedCard {
  key: string
  spanIndex: number
}

interface CardSize {
  height: number
  settledHeight: number
}

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

/**
 * Places a rail's cards beside their anchors by writing each card's `top`, and the rail's height,
 * to the elements themselves, so a re-placement renders nothing. One observer watches the document
 * and every attached card while connected, and re-places synchronously in its callback, which runs
 * after layout and before paint: neighbors follow an easing card in the same frame. An observation
 * re-reads only what it reports: the cards that resized, and anchor offsets only when the document
 * resized, since anchors move only with it; cards still settling also re-read their settled heights.
 * `update` measures everything, for a new set of cards or a new selection.
 */
export class RailPlacement {
  private observer: ResizeObserver | null = null
  private readonly elements = new Map<string, HTMLElement>()
  private readonly keys = new Map<Element, string>()
  private readonly sizes = new Map<string, CardSize>()
  private cards: readonly PlacedCard[] = []
  private selected: number | null = null
  private doc: HTMLElement | null = null
  private rail: HTMLElement | null = null
  private drafts: HTMLElement | null = null
  /** The element each card's anchor span renders as, found once per set of cards and document. */
  private anchors = new Map<number, Element>()
  private anchorsFor: readonly PlacedCard[] | null = null
  private anchorTops = new Map<number, number>()
  private docHeight = 0
  private height = 0
  private placedKeys: readonly string[] = []

  /** `onPlaced` receives the keys of the placed cards whenever that set changes. */
  constructor(private readonly gap: number, private readonly onPlaced: (keys: readonly string[]) => void) {}

  connect(): void {
    if (this.observer) return
    this.observer = new ResizeObserver((entries) => this.resized(entries))
    if (this.doc) this.observer.observe(this.doc)
    this.elements.forEach((element) => this.observer!.observe(element))
  }

  disconnect(): void {
    this.observer?.disconnect()
    this.observer = null
  }

  /** Tracks a card's element; returns its release, for a React ref callback. */
  attach(key: string, element: HTMLElement): () => void {
    this.elements.set(key, element)
    this.keys.set(element, key)
    this.observer?.observe(element)
    return () => {
      this.observer?.unobserve(element)
      this.keys.delete(element)
      if (this.elements.get(key) !== element) return
      this.elements.delete(key)
      this.sizes.delete(key)
    }
  }

  element(key: string): HTMLElement | undefined {
    return this.elements.get(key)
  }

  /** Tracks the rail element, for a React ref callback. */
  setRail(rail: HTMLElement | null): void {
    this.rail = rail
    this.writeHeight()
  }

  /** Tracks the block of drafts whose discussions are gone, which follows the cards. */
  setDrafts(drafts: HTMLElement | null): void {
    this.drafts = drafts
    this.writeHeight()
  }

  /** Measures every card and anchor and places them; `selected` is the selected card's span index. */
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
    this.cards = cards
    this.selected = selected
    if (!doc || !this.rail) return
    this.elements.forEach((element, key) => this.sizes.set(key, measureCard(element)))
    this.measureAnchors()
    this.place()
  }

  private resized(entries: readonly ResizeObserverEntry[]): void {
    if (!this.doc || !this.rail) return
    let docResized = false
    const resizedCards = new Set<string>()
    for (const entry of entries) {
      if (entry.target === this.doc) { docResized = true; continue }
      const key = this.keys.get(entry.target)
      if (key === undefined) continue
      this.sizes.set(key, measureCard(entry.target as HTMLElement, observedHeight(entry)))
      resizedCards.add(key)
    }
    this.sizes.forEach((size, key) => {
      const element = this.elements.get(key)
      if (element && !resizedCards.has(key) && size.settledHeight < size.height) this.sizes.set(key, measureCard(element, size.height))
    })
    if (docResized) this.measureAnchors()
    this.place()
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
      return { anchorTop: this.anchorTops.get(card.spanIndex) ?? 0, height: size?.height ?? 0,
        settledHeight: size?.settledHeight }
    })
    const tops = placeCommentCards(measurements, this.cards.findIndex((card) => card.spanIndex === this.selected), this.gap)
    this.cards.forEach((card, i) => {
      const element = this.elements.get(card.key)
      if (element) setPixels(element, 'top', tops[i]!)
    })
    this.height = Math.max(this.docHeight, ...tops.map((top, i) => top + measurements[i]!.height))
    this.writeHeight()
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
}
