interface RailMeasurement {
  anchorTop: number
  height: number
}

/** Keep document order; selected cards can reclaim space above crowded anchors. */
export function placeCommentCards(cards: readonly RailMeasurement[], selected: number, gap: number): number[] {
  const tops: number[] = []
  const minimumTops: number[] = []
  let minimum = 0
  let cursor = 0
  cards.forEach((card, index) => {
    minimumTops[index] = minimum
    minimum += card.height + gap
    tops[index] = Math.max(card.anchorTop, cursor)
    cursor = tops[index]! + card.height + gap
  })
  if (selected < 0 || selected >= cards.length) return tops

  // Earlier cards must still fit above the selection without leaving the document surface.
  tops[selected] = Math.max(cards[selected]!.anchorTop, minimumTops[selected]!)
  for (let i = selected - 1; i >= 0; i--) {
    tops[i] = Math.min(cards[i]!.anchorTop, tops[i + 1]! - cards[i]!.height - gap)
    tops[i] = Math.max(minimumTops[i]!, tops[i]!)
  }
  for (let i = selected + 1; i < cards.length; i++) {
    tops[i] = Math.max(cards[i]!.anchorTop, tops[i - 1]! + cards[i - 1]!.height + gap)
  }
  return tops
}
