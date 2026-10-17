// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHomeMotion } from '../ui/desktop/home-motion'

let surface: HTMLElement
let motion: ReturnType<typeof createHomeMotion>
let reduced = false
let nextFrame: FrameRequestCallback
const pending: { element: HTMLElement; frames: Keyframe[]; duration: number; finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = []
const originalAnimate = HTMLElement.prototype.animate
beforeEach(() => {
  reduced = false
  pending.length = 0
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced } }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { nextFrame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
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
    pending.push({ element: this, frames: frames as Keyframe[], duration: (options as KeyframeAnimationOptions).duration as number, finish, cancel })
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

it('drifts intact rows within the approved range and resets for reduced motion', () => {
  motion.show(true)
  nextFrame(10_000)
  const rows = [...surface.querySelectorAll<HTMLElement>('span')]
  expect(rows.map((row) => row.textContent)).toEqual(['█▀▄▀█', '█░▀░█'])
  expect(rows[0]!.style.transform).not.toBe(rows[1]!.style.transform)
  for (const row of rows) {
    const [x, y] = row.style.transform.match(/-?[\d.]+/g)!.map(Number)
    expect(Math.abs(x!)).toBeLessThanOrEqual(3)
    expect(Math.abs(y!)).toBeLessThanOrEqual(1.5)
    expect(row.children).toHaveLength(0)
  }
  reduced = true
  nextFrame(10_016)
  expect(rows.every((row) => row.style.transform === 'translate(0px, 0px)')).toBe(true)
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

it('cancels pending animation and releases departure on unmount', async () => {
  motion.show(true)
  const leaving = motion.leave(true)
  motion.dispose()
  await leaving
  expect(pending.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true)
  expect(cancelAnimationFrame).toHaveBeenCalled()
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
