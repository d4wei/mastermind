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
 * Each card's top by key, from a placement of `keys` in order. Returns `previous` when nothing
 * moved, so an unchanged placement re-renders nothing; a card keeps its top across re-placements
 * by its identity, never by its index among cards that came or went.
 */
export function placedTops(keys: readonly string[], tops: readonly number[], previous: ReadonlyMap<string, number>):
  ReadonlyMap<string, number> {
  const unchanged = previous.size === keys.length && keys.every((key, i) => previous.get(key) === tops[i])
  return unchanged ? previous : new Map(keys.map((key, i) => [key, tops[i]!]))
}
