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

it('never pushes a card up for height it is collapsing, and lets the selection rise as it closes', () => {
  // The upper card closes from 400 to 100; the lower one is now selected beside its anchor at 300.
  const frames = [400, 250, 160, 100].map((height) => placeCommentCards([
    { anchorTop: 100, height, settledHeight: 100 },
    { anchorTop: 300, height: 60 },
  ], 1, 8))
  expect(frames.map((tops) => tops[0])).toEqual([100, 100, 100, 100])
  expect(frames.map((tops) => tops[1])).toEqual([508, 358, 300, 300])
  // Settled, it places exactly as without the collapse.
  expect(frames.at(-1)).toEqual(placeCommentCards([{ anchorTop: 100, height: 100 }, { anchorTop: 300, height: 60 }], 1, 8))
})

it('still reclaims the room a collapsing card keeps, at once rather than past it and back', () => {
  const tops = placeCommentCards([{ anchorTop: 100, height: 400, settledHeight: 200 }, { anchorTop: 250, height: 60 }], 1, 8)
  expect(tops).toEqual([42, 450])
  expect(placeCommentCards([{ anchorTop: 100, height: 200 }, { anchorTop: 250, height: 60 }], 1, 8)).toEqual([42, 250])
})
