import { expect, it } from 'vitest'
import { CardHeightEstimator, placeCommentCards, type RailSurface } from '../ui/review/rail-layout'

/** A document with no end in sight and no scroller, so only passages and order place the selection. */
const OPEN: RailSurface = { documentBottom: Infinity, view: null }
/** A card as tall as its passage, which every alignment rule places at the passage's top. */
const flush = (anchorTop: number, height: number) => ({ anchorTop, anchorHeight: height, height })

it('gives a selected crowded discussion its anchor while retaining readable neighbors', () => {
  const cards = [300, 340, 380].map((anchorTop) => flush(anchorTop, 100))
  expect(placeCommentCards(cards, -1, 8, OPEN)).toEqual([300, 408, 516])
  expect(placeCommentCards(cards, 2, 8, OPEN)).toEqual([164, 272, 380])
  cards[1] = flush(340, 420)
  expect(placeCommentCards(cards, 1, 8, OPEN)).toEqual([232, 340, 768])
})

it('keeps cards on the surface when there is insufficient room before the selected anchor', () => {
  const cards = [0, 0, 20].map((anchorTop) => flush(anchorTop, 100))
  expect(placeCommentCards(cards, 2, 8, OPEN)).toEqual([0, 108, 216])
  expect(placeCommentCards([], 0, 8, OPEN)).toEqual([])
})

it('never overlaps cards or changes source order across crowded and sparse layouts', () => {
  const heights = [40, 140, 800, 64, 220]
  const surfaces: RailSurface[] = [OPEN, { documentBottom: 300, view: null }, { documentBottom: 2000, view: { top: 100, bottom: 400 } }]
  for (const spacing of [0, 12, 80, 800]) {
    const cards = heights.map((height, i) => ({ height, anchorTop: i * spacing, anchorHeight: 20 }))
    for (const surface of surfaces) {
      for (let selected = -1; selected < cards.length; selected++) {
        const tops = placeCommentCards(cards, selected, 8, surface)
        expect(tops[0]).toBeGreaterThanOrEqual(0)
        for (let i = 1; i < cards.length; i++) {
          expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]! + heights[i - 1]! + 8)
        }
      }
    }
  }
})

it('never pushes a card up for height it is collapsing, and lets the selection rise as it closes', () => {
  // The upper card closes from 400 to 100; the lower one is now selected beside its anchor at 300.
  const frames = [400, 250, 160, 100].map((height) => placeCommentCards([
    { anchorTop: 100, anchorHeight: 20, height, settledHeight: 100 },
    flush(300, 60),
  ], 1, 8, OPEN))
  expect(frames.map((tops) => tops[0])).toEqual([100, 100, 100, 100])
  expect(frames.map((tops) => tops[1])).toEqual([508, 358, 300, 300])
  // Settled, it places exactly as without the collapse.
  expect(frames.at(-1)).toEqual(placeCommentCards([flush(100, 100), flush(300, 60)], 1, 8, OPEN))
})

it('still reclaims the room a collapsing card keeps, at once rather than past it and back', () => {
  const tops = placeCommentCards([{ anchorTop: 100, anchorHeight: 20, height: 400, settledHeight: 200 }, flush(250, 60)], 1, 8, OPEN)
  expect(tops).toEqual([42, 450])
  expect(placeCommentCards([flush(100, 200), flush(250, 60)], 1, 8, OPEN)).toEqual([42, 250])
})

/** Where a lone selected card of `height` sits beside a passage at 500 to 520. */
const alone = (height: number, surface: RailSurface = OPEN, passage = 20) =>
  placeCommentCards([{ anchorTop: 500, anchorHeight: passage, height }], 0, 8, surface)[0]

it('centers a selected card on a passage shorter than itself', () => {
  expect(alone(200)).toBe(410)
  // Unselected, it starts at its passage's top.
  expect(placeCommentCards([{ anchorTop: 500, anchorHeight: 20, height: 200 }], -1, 8, OPEN)).toEqual([500])
})

it('starts a selected card at the top of a passage no shorter than itself', () => {
  expect(alone(100, OPEN, 400)).toBe(500)
  expect(alone(100, OPEN, 100)).toBe(500)
})

it('rides a selected card up near the document end, never below its ideal and never off its passage', () => {
  expect(alone(200, { documentBottom: 560, view: null })).toBe(360)
  // Its bottom may still pass the end: it stays across its passage's lines.
  expect(alone(200, { documentBottom: 400, view: null })).toBe(320)
  // A document ending well below it leaves it centered.
  expect(alone(200, { documentBottom: 900, view: null })).toBe(410)
})

it('shifts a selected card into the view its selection was made in, top first', () => {
  // The view's top edge.
  expect(placeCommentCards([{ anchorTop: 470, anchorHeight: 20, height: 200 }], 0, 8,
    { documentBottom: Infinity, view: { top: 450, bottom: 1450 } })).toEqual([458])
  // The view's bottom edge.
  expect(alone(200, { documentBottom: Infinity, view: { top: 0, bottom: 600 } })).toBe(392)
  // Taller than the view, the card keeps its top in view.
  expect(placeCommentCards([{ anchorTop: 470, anchorHeight: 20, height: 200 }], 0, 8,
    { documentBottom: Infinity, view: { top: 450, bottom: 600 } })).toEqual([458])
})

it('ignores the view when the passage was outside it', () => {
  expect(alone(200, { documentBottom: Infinity, view: { top: 0, bottom: 400 } })).toBe(410)
  expect(alone(200, { documentBottom: Infinity, view: { top: 520, bottom: 1500 } })).toBe(410)
})

it('clamps a selected card back onto its passage after the view moves it', () => {
  // The passage straddles the view's bottom edge; the view would lift the card off it.
  expect(placeCommentCards([{ anchorTop: 390, anchorHeight: 20, height: 200 }], 0, 8,
    { documentBottom: Infinity, view: { top: 0, bottom: 400 } })).toEqual([210])
  // A short card within a tall passage stays inside it.
  expect(alone(100, { documentBottom: Infinity, view: { top: 0, bottom: 560 } }, 400)).toBe(500)
})

it('lets order outrank alignment: earlier cards fit above, later ones clear below', () => {
  const tops = placeCommentCards([flush(0, 100), flush(10, 100), { anchorTop: 20, anchorHeight: 20, height: 200 },
    flush(30, 50)], 2, 8, OPEN)
  expect(tops).toEqual([0, 108, 216, 424])
})

it('keeps a growing selected card centered on its passage, frame by frame', () => {
  const centers = [40, 90, 150, 200].map((height) => alone(height)! + height / 2)
  expect(centers).toEqual([510, 510, 510, 510])
})

const discussion = (body: string, replies = 0, anchorText = 'a passage') => ({ key: body, spanIndex: 0, anchorText,
  thread: { comments: [{ author: 'a', body }, ...Array.from({ length: replies }, () => ({ author: 'b', body: 'reply' }))] } })

it('estimates unrendered cards from their content, scaled by how measured cards compared', () => {
  const estimator = new CardHeightEstimator()
  const short = discussion('short'), long = discussion('word '.repeat(60)), replied = discussion('short', 2)
  const paragraphs = discussion('short\n\nshort')
  expect(estimator.estimate(long)).toBeGreaterThan(estimator.estimate(short))
  expect(estimator.estimate(replied)).toBeGreaterThan(estimator.estimate(short))
  expect(estimator.estimate(paragraphs)).toBeGreaterThan(estimator.estimate(short))
  expect(estimator.estimate(discussion('short', 0, ''))).toBeLessThan(estimator.estimate(short))
  const raw = estimator.estimate(long)
  // A card measured at twice its estimate doubles every estimate.
  estimator.learn(short, 2 * estimator.estimate(short))
  expect(estimator.estimate(long)).toBeCloseTo(2 * raw)
  // The ratio follows the running totals, and ignores drift under 2%.
  const other = discussion('other')
  estimator.learn(other, 1.005 * estimator.estimate(other))
  expect(estimator.estimate(long)).toBeCloseTo(2 * raw)
  estimator.reset()
  expect(estimator.estimate(long)).toBeCloseTo(raw)
})
