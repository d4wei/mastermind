import { describe, expect, it } from 'vitest'
import { CardHeightEstimator, placeCommentCards, type RailMeasurement } from '../ui/review/rail-layout'

const GAP = 8
/** A card whose opening message's body starts 60 px below its top, below a quoted passage. */
const quoted = (anchorTop: number, height: number): RailMeasurement => ({ anchorTop, bodyOffset: 60, height })
const place = (cards: readonly RailMeasurement[], pivot = -1) => placeCommentCards(cards, pivot, GAP)

describe('alignment', () => {
  it('puts the opening message\'s body level with the top of its passage', () => {
    expect(place([quoted(500, 120)])).toEqual([440])
    expect(place([quoted(500, 120)], 0)).toEqual([440])
  })

  it('aligns a point comment by its smaller body offset', () => {
    expect(place([{ anchorTop: 500, bodyOffset: 36, height: 80 }])).toEqual([464])
    expect(place([{ anchorTop: 500, bodyOffset: 36, height: 80 }], 0)).toEqual([464])
  })

  it('keeps every card at or below the rail\'s top', () => {
    expect(place([quoted(20, 100)])).toEqual([0])
    expect(place([quoted(20, 100), quoted(30, 100), quoted(40, 100)], 2)).toEqual([0, 108, 216])
    expect(place([], 0)).toEqual([])
  })
})

describe('stacking', () => {
  it('stacks in source order without a pivot, each at its aligned top or a gap below the card before', () => {
    expect(place([quoted(300, 100), quoted(340, 100), quoted(800, 100)])).toEqual([240, 348, 740])
  })

  it('gives the pivot its alignment in a crowded cluster, earlier cards above and later ones below', () => {
    const cards = [quoted(300, 100), quoted(340, 100), quoted(380, 100), quoted(420, 100)]
    expect(place(cards)).toEqual([240, 348, 456, 564])
    expect(place(cards, 2)).toEqual([104, 212, 320, 428])
  })

  it('leaves earlier cards that already sit clear of the pivot at their own alignment', () => {
    expect(place([quoted(100, 100), quoted(600, 100)], 1)).toEqual([40, 540])
  })

  it('moves the pivot down only as far as earlier cards need to fit below the rail\'s top', () => {
    expect(place([quoted(0, 100), quoted(10, 100), quoted(130, 100)], 2)).toEqual([0, 108, 216])
  })

  it('never overlaps cards or changes source order across crowded and sparse layouts', () => {
    const heights = [40, 140, 800, 64, 220]
    for (const spacing of [0, 12, 80, 800]) {
      const cards = heights.map((height, i) => ({ height, anchorTop: i * spacing, bodyOffset: 30 + i * 7 }))
      for (let pivot = -1; pivot < cards.length; pivot++) {
        const tops = place(cards, pivot)
        expect(tops[0]).toBeGreaterThanOrEqual(0)
        for (let i = 1; i < cards.length; i++) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]! + heights[i - 1]! + GAP)
      }
    }
  })
})

describe('the pivot', () => {
  /** A crowded cluster whose third card is selected at 400 px tall, or unselected at 100. */
  const cluster = (third: number) => [quoted(300, 100), quoted(340, 100), quoted(380, third), quoted(420, 100), quoted(460, 100)]

  it('stays where it is after deselection; only the cards its shrinking releases move', () => {
    const selected = place(cluster(400), 2)
    const deselected = place(cluster(100), 2)
    expect(selected.slice(0, 3)).toEqual(deselected.slice(0, 3))
    expect(selected.slice(3)).toEqual([728, 836])
    expect(deselected.slice(3)).toEqual([428, 536])
  })

  it('moves to a newly selected card', () => {
    expect(place(cluster(100), 2)).toEqual([104, 212, 320, 428, 536])
    expect(place(cluster(100), 3)).toEqual([36, 144, 252, 360, 468])
  })

  it('grows a selected card downward only: its top, and so its body line, hold while later cards follow', () => {
    const frames = [100, 180, 260, 400].map((height) => place(cluster(height), 2))
    expect(frames.map((tops) => tops[2])).toEqual([320, 320, 320, 320])
    expect(frames.map((tops) => tops[1])).toEqual([212, 212, 212, 212])
    expect(frames.map((tops) => tops[3])).toEqual([428, 508, 588, 728])
  })

  it('brings later cards back as a selected card shrinks', () => {
    const grown = place(cluster(400), 2)
    const shrunk = place(cluster(100), 2)
    expect(grown[3]).toBe(728)
    expect(shrunk).toEqual(place(cluster(100), 2))
    expect(shrunk[3]).toBe(428)
  })

  it('never pushes a card up for height it is collapsing, and keeps the pivot clear of its current bottom', () => {
    // The upper card closes from 400 to 100; the lower one is the pivot beside its anchor at 360.
    const frames = [400, 250, 160, 100].map((height) => place([
      { anchorTop: 160, bodyOffset: 60, height, settledHeight: 100 },
      quoted(360, 60),
    ], 1))
    expect(frames.map((tops) => tops[0])).toEqual([100, 100, 100, 100])
    expect(frames.map((tops) => tops[1])).toEqual([508, 358, 300, 300])
    expect(frames.at(-1)).toEqual(place([quoted(160, 100), quoted(360, 60)], 1))
  })
})

const discussion = (body: string, replies = 0, anchorText = 'a passage') => ({ key: body, spanIndex: 0, anchorText,
  thread: { comments: [{ author: 'a', body }, ...Array.from({ length: replies }, () => ({ author: 'b', body: 'reply' }))] } })

describe('estimates', () => {
  it('estimates unrendered cards\' heights from their content, scaled by how measured cards compared', () => {
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

  it('estimates an unmounted card\'s body offset from the passage above it, calibrated by measured offsets', () => {
    const estimator = new CardHeightEstimator()
    const oneLine = discussion('short', 0, 'brief'), twoLines = discussion('short', 0, 'passage '.repeat(20))
    const point = discussion('short', 0, '')
    // The body sits below the passage's lines, so a longer passage lowers it until the clamp; the body's own length does not.
    expect(estimator.bodyOffset(twoLines)).toBeGreaterThan(estimator.bodyOffset(oneLine))
    expect(estimator.bodyOffset(discussion('short', 0, 'passage '.repeat(80)))).toBe(estimator.bodyOffset(twoLines))
    expect(estimator.bodyOffset(point)).toBeLessThan(estimator.bodyOffset(oneLine))
    expect(estimator.bodyOffset(discussion('word '.repeat(60), 3, 'brief'))).toBe(estimator.bodyOffset(oneLine))
    // An estimate never exceeds the card's estimated height.
    expect(estimator.bodyOffset(oneLine)).toBeLessThan(estimator.estimate(oneLine))
    // A measured offset calibrates offsets without touching heights.
    const height = estimator.estimate(oneLine)
    const raw = estimator.bodyOffset(twoLines)
    estimator.learn(oneLine, height, undefined, estimator.bodyOffset(oneLine) / 2)
    expect(estimator.bodyOffset(twoLines)).toBeCloseTo(raw / 2)
    expect(estimator.estimate(oneLine)).toBeCloseTo(height)
  })
})
