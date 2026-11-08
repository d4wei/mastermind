const DRIFT_PX = 3
/** Noise lattice points per second along the horizontal path; the vertical path runs at 0.7×. */
const DRIFT_SPEED = 0.5
/** Both paths complete whole lattice cycles in this period (20 and 14 points), so the loop closes. */
const DRIFT_PERIOD_S = 40
const DRIFT_SAMPLES_PER_S = 4
const DEPARTURE_MS = 260
const FADE_MS = 240

/**
 * Smooth value noise whose lattice repeats every `period` points. Lattice point zero is at rest,
 * and the smoothstep blend has zero slope at lattice points, so a drift starts from stillness.
 */
function noise(time: number, seed: number, period: number): number {
  const random = (index: number): number => {
    const n = ((index % period) + period) % period
    if (n === 0) return 0
    const value = Math.sin((seed + n) * 127.1 + 311.7) * 43758.5453
    return (value - Math.floor(value)) * 2 - 1
  }
  const index = Math.floor(time)
  const fraction = time - index
  const blend = fraction * fraction * (3 - 2 * fraction)
  return random(index) * (1 - blend) + random(index + 1) * blend
}

/** One loop of a row's drift as sampled keyframes, so the compositor can run it unattended. */
function driftFrames(row: number): Keyframe[] {
  const samples = DRIFT_PERIOD_S * DRIFT_SAMPLES_PER_S
  return Array.from({ length: samples + 1 }, (_, sample) => {
    const seconds = sample / DRIFT_SAMPLES_PER_S
    const x = noise(seconds * DRIFT_SPEED, 31 + row * 73, DRIFT_PERIOD_S * DRIFT_SPEED) * DRIFT_PX
    const y = noise(seconds * DRIFT_SPEED * 0.7, 113 + row * 53, DRIFT_PERIOD_S * DRIFT_SPEED * 0.7) * DRIFT_PX * 0.5
    return { transform: `translate(${x.toFixed(3)}px, ${y.toFixed(3)}px)` }
  })
}

export function createHomeMotion(surface: HTMLElement) {
  const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const animations = new Set<Animation>()
  let drifts: Animation[] = []
  let home = false
  let leaving = false
  let faded = false
  let disposed = false
  const rows = (): HTMLElement[] => Array.from(surface.querySelectorAll('.native-wordmark-row'))
  const reduced = (): boolean => preference?.matches ?? false
  const animatable = (): boolean => typeof surface.animate === 'function'

  async function animate(element: HTMLElement, frames: Keyframe[], duration: number) {
    const animation = element.animate(frames, { duration, fill: 'forwards' })
    animations.add(animation)
    await animation.finished.catch(() => {})
    return animation
  }
  function clearAnimations() {
    animations.forEach((animation) => animation.cancel())
    animations.clear()
  }
  function stopDrift() {
    drifts.forEach((animation) => animation.cancel())
    drifts = []
  }
  // The drift is a looping keyframe animation of transform alone, which the engine can hand to its
  // compositor instead of waking the page every frame.
  function startDrift() {
    stopDrift()
    if (disposed || !home || leaving || reduced() || !animatable()) return
    drifts = rows().map((row, index) => row.animate(driftFrames(index),
      { duration: DRIFT_PERIOD_S * 1000, iterations: Infinity, easing: 'linear' }))
  }
  const preferenceChanged = (): void => { if (reduced()) stopDrift(); else if (!drifts.length) startDrift() }
  preference?.addEventListener?.('change', preferenceChanged)
  return {
    show(atHome: boolean) {
      home = atHome
      leaving = false
      if (faded) {
        clearAnimations()
        faded = false
        if (!reduced() && animatable()) {
          void animate(surface, [{ opacity: 0, easing: 'ease-out' }, { opacity: 1 }], FADE_MS)
            .then((animation) => { animation.cancel(); animations.delete(animation) })
        }
      }
      startDrift()
    },
    async leave(fromHome: boolean) {
      if (disposed || leaving || home !== fromHome || reduced() || !animatable()) return
      leaving = true
      faded = true
      clearAnimations()
      const departures: Promise<Animation>[] = []
      if (home) {
        const bounds = surface.getBoundingClientRect()
        // Depart from wherever the drift has carried each row.
        const starts = rows().map((row) => getComputedStyle(row).transform)
        stopDrift()
        rows().forEach((row, index) => {
          const rect = row.getBoundingClientRect()
          const direction = index === 0 ? -1 : 1
          const travel = direction < 0 ? rect.right - bounds.left : bounds.right - rect.left
          // Clear the viewport before the last frame so the screen swap cannot truncate departure.
          const end = direction * (travel + DRIFT_PX)
          const start = starts[index] && starts[index] !== 'none' ? starts[index] : 'translate(0, 0)'
          departures.push(animate(row, [
            { transform: start, offset: 0, easing: 'ease-out' },
            { transform: 'translate(0, 0)', offset: 0.12, easing: 'cubic-bezier(.45,0,.85,.55)' },
            { transform: `translate(${end}px, 0)`, offset: 0.78 },
            { transform: `translate(${end + direction * bounds.width * 0.1}px, 0)`, offset: 1 },
          ], DEPARTURE_MS))
        })
      }
      await Promise.all([
        ...departures,
        animate(surface, [{ opacity: 1, easing: 'ease-out' }, { opacity: 0 }], FADE_MS),
      ])
    },
    dispose() {
      disposed = true
      preference?.removeEventListener?.('change', preferenceChanged)
      stopDrift()
      clearAnimations()
    },
  }
}
