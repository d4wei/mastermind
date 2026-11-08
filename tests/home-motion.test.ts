// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHomeMotion } from '../ui/desktop/home-motion'

let surface: HTMLElement
let motion: ReturnType<typeof createHomeMotion>
let reduced = false
let preferenceChange: (() => void) | undefined
interface Recorded { element: HTMLElement; frames: Keyframe[]; duration: number; iterations?: number; finish: () => void; cancel: ReturnType<typeof vi.fn> }
const recorded: Recorded[] = []
/** Screen transitions; drift loops are recorded apart from them. */
let pending: Recorded[] = []
const drifts = () => recorded.filter((animation) => animation.iterations === Infinity)
const originalAnimate = HTMLElement.prototype.animate
beforeEach(() => {
  reduced = false
  recorded.length = 0
  pending = []
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return reduced },
    addEventListener: (_: string, listener: () => void) => { preferenceChange = listener },
    removeEventListener: () => { preferenceChange = undefined },
  }))
  surface = document.createElement('main')
  const wordmark = document.createElement('pre')
  for (const text of ['█▀▄▀█', '█░▀░█']) {
    const row = document.createElement('span')
    row.className = 'native-wordmark-row'
    row.textContent = text
    row.getBoundingClientRect = () => ({ left: 200, right: 600, width: 400 } as DOMRect)
    wordmark.append(row)
  }
  surface.append(wordmark)
  surface.getBoundingClientRect = () => ({ left: 0, right: 800, width: 800 } as DOMRect)
  document.body.append(surface)
  HTMLElement.prototype.animate = function (frames, options) {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => { finish = resolve })
    const cancel = vi.fn(() => finish())
    const { duration, iterations } = options as KeyframeAnimationOptions
    const animation = { element: this, frames: frames as Keyframe[], duration: duration as number, iterations, finish, cancel }
    recorded.push(animation)
    if (iterations !== Infinity) pending.push(animation)
    return { finished, cancel } as unknown as Animation
  }
  motion = createHomeMotion(surface)
})
afterEach(() => {
  motion.dispose()
  surface.remove()
  HTMLElement.prototype.animate = originalAnimate
  vi.unstubAllGlobals()
})

const offsets = (frame: Keyframe) => String(frame.transform).match(/-?[\d.]+/g)!.map(Number)

it('drifts intact rows within the approved range as a closed compositor loop, starting at rest', () => {
  motion.show(true)
  const loops = drifts()
  expect(loops.map((loop) => loop.element.textContent)).toEqual(['█▀▄▀█', '█░▀░█'])
  expect(JSON.stringify(loops[0]!.frames)).not.toBe(JSON.stringify(loops[1]!.frames))
  for (const loop of loops) {
    expect(loop.element.children).toHaveLength(0)
    expect(loop.element.style.transform).toBe('')
    expect(offsets(loop.frames[0]!)).toEqual([0, 0])
    expect(offsets(loop.frames.at(-1)!)).toEqual([0, 0])
    const moves = loop.frames.map(offsets)
    expect(moves.some(([x]) => Math.abs(x!) > 0.5)).toBe(true)
    for (const [x, y] of moves) {
      expect(Math.abs(x!)).toBeLessThanOrEqual(3)
      expect(Math.abs(y!)).toBeLessThanOrEqual(1.5)
    }
  }
  // No per-frame script runs while the drift plays.
  expect(pending).toHaveLength(0)
})

it('stops the drift for reduced motion, resumes it when allowed, and never drifts off home', () => {
  reduced = true
  motion.show(true)
  expect(drifts()).toHaveLength(0)
  reduced = false
  preferenceChange!()
  expect(drifts()).toHaveLength(2)
  reduced = true
  preferenceChange!()
  expect(drifts().every((loop) => loop.cancel.mock.calls.length === 1)).toBe(true)
  reduced = false
  motion.show(false)
  preferenceChange!()
  expect(drifts()).toHaveLength(2)
})

it('clears both viewport edges before completing departure and fades the new screen', async () => {
  motion.show(true)
  const leaving = motion.leave(true)
  expect(pending).toHaveLength(3)
  const [top, bottom, fade] = pending
  expect(top!.duration).toBe(260)
  expect(bottom!.duration).toBe(260)
  expect(top!.frames[2]).toMatchObject({ offset: 0.78, transform: 'translate(-603px, 0)' })
  expect(bottom!.frames[2]).toMatchObject({ offset: 0.78, transform: 'translate(603px, 0)' })
  expect(fade!.element).toBe(surface)
  expect(fade!.duration).toBe(240)
  expect(fade!.frames.map((frame) => frame.opacity)).toEqual([1, 0])
  let finished = false
  void leaving.then(() => { finished = true })
  fade!.finish()
  await Promise.resolve()
  expect(finished).toBe(false)
  top!.finish(); bottom!.finish()
  await leaving
  motion.show(false)
  expect(pending[3]!.element).toBe(surface)
  expect(pending[3]!.frames.map((frame) => frame.opacity)).toEqual([0, 1])
  expect(pending[3]!.duration).toBe(240)
})

it('fades the document before returning home without moving a button', async () => {
  motion.show(false)
  const leaving = motion.leave(false)
  expect(pending).toHaveLength(1)
  expect(pending[0]!.element).toBe(surface)
  pending[0]!.finish()
  await leaving
  motion.show(true)
  expect(pending).toHaveLength(2)
  expect(pending.every((animation) => animation.element === surface)).toBe(true)
})

it('skips transitions with reduced motion or an unavailable animation API', async () => {
  motion.show(true)
  reduced = true
  await motion.leave(true)
  motion.show(false)
  expect(pending).toHaveLength(0)
  reduced = false
  HTMLElement.prototype.animate = undefined as unknown as typeof originalAnimate
  await motion.leave(false)
  motion.show(true)
  expect(pending).toHaveLength(0)
})

it('cancels pending animation and the drift and releases departure on unmount', async () => {
  motion.show(true)
  const leaving = motion.leave(true)
  motion.dispose()
  await leaving
  expect(recorded.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true)
  motion.show(true)
  expect(drifts()).toHaveLength(2)
})

it('ignores departures from a screen that is not showing and coalesces repeats', async () => {
  motion.show(true)
  await motion.leave(false)
  expect(pending).toHaveLength(0)
  const leaving = motion.leave(true)
  await motion.leave(true)
  expect(pending).toHaveLength(3)
  pending.forEach((animation) => animation.finish())
  await leaving
})
