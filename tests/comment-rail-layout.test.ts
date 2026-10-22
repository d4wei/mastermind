import { expect, it } from 'vitest'
import { placeCommentCards } from '../ui/review/rail-layout'

it('gives a selected crowded discussion its anchor while retaining readable neighbors', () => {
  const cards = [300, 340, 380].map((anchorTop) => ({ anchorTop, height: 100 }))
  expect(placeCommentCards(cards, -1, 8)).toEqual([300, 408, 516])
  expect(placeCommentCards(cards, 2, 8)).toEqual([164, 272, 380])
  cards[1]!.height = 420
  expect(placeCommentCards(cards, 1, 8)).toEqual([232, 340, 768])
})

it('keeps cards on the surface when there is insufficient room before the selected anchor', () => {
  const cards = [0, 0, 20].map((anchorTop) => ({ anchorTop, height: 100 }))
  expect(placeCommentCards(cards, 2, 8)).toEqual([0, 108, 216])
  expect(placeCommentCards([], 0, 8)).toEqual([])
})

it('never overlaps cards or changes source order across crowded and sparse layouts', () => {
  const heights = [40, 140, 800, 64, 220]
  for (const spacing of [0, 12, 80, 800]) {
    const cards = heights.map((height, i) => ({ height, anchorTop: i * spacing }))
    for (let selected = -1; selected < cards.length; selected++) {
      const tops = placeCommentCards(cards, selected, 8)
      expect(tops[0]).toBeGreaterThanOrEqual(0)
      for (let i = 1; i < cards.length; i++) {
        expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]! + heights[i - 1]! + 8)
      }
    }
  }
})
