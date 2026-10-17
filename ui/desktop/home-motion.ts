const DRIFT_PX = 3
const DRIFT_SPEED = 0.5
const DEPARTURE_MS = 260
const FADE_MS = 240

function noise(time: number, seed: number): number {
  const random = (n: number): number => {
    const value = Math.sin(n * 127.1 + 311.7) * 43758.5453
    return (value - Math.floor(value)) * 2 - 1
  }
  const index = Math.floor(time)
  const fraction = time - index
  const blend = fraction * fraction * (3 - 2 * fraction)
  return random(seed + index) * (1 - blend) + random(seed + index + 1) * blend
}

export function createHomeMotion(surface: HTMLElement) {
  const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const animations = new Set<Animation>()
  let home = false
  let leaving = false
  let faded = false
  let disposed = false
  let frame = 0
  let returnedAt = 0
  const rows = (): HTMLElement[] => Array.from(surface.querySelectorAll('.native-wordmark-row'))
  const reduced = (): boolean => preference?.matches ?? false

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
  function tick(now: number) {
    if (disposed) return
    if (home && !leaving && !document.hidden) {
      const amplitude = reduced() ? 0 : DRIFT_PX * Math.min(1, (now - returnedAt) / 1000)
      rows().forEach((row, index) => {
        const time = now / 1000 * DRIFT_SPEED
        const x = noise(time + index * 11, 31 + index * 73) * amplitude
        const y = noise(time * 0.7 + index * 7, 113 + index * 53) * amplitude * 0.5
        row.style.transform = `translate(${x}px, ${y}px)`
      })
    }
    if (home) frame = requestAnimationFrame(tick)
  }
  return {
    show(atHome: boolean) {
      home = atHome
      leaving = false
      cancelAnimationFrame(frame)
      returnedAt = performance.now()
      if (faded) {
        clearAnimations()
        rows().forEach((row) => { row.style.transform = '' })
        faded = false
        if (!reduced() && typeof surface.animate === 'function') {
          void animate(surface, [{ opacity: 0, easing: 'ease-out' }, { opacity: 1 }], FADE_MS)
            .then((animation) => { animation.cancel(); animations.delete(animation) })
        }
      }
      if (home) frame = requestAnimationFrame(tick)
    },
    async leave(fromHome: boolean) {
      if (disposed || leaving || home !== fromHome || reduced() || typeof surface.animate !== 'function') return
      leaving = true
      faded = true
      clearAnimations()
      const departures: Promise<Animation>[] = []
      if (home) {
        const bounds = surface.getBoundingClientRect()
        rows().forEach((row, index) => {
          const rect = row.getBoundingClientRect()
          const direction = index === 0 ? -1 : 1
          const travel = direction < 0 ? rect.right - bounds.left : bounds.right - rect.left
          // Clear the viewport before the last frame so the screen swap cannot truncate departure.
          const end = direction * (travel + DRIFT_PX)
          departures.push(animate(row, [
            { transform: row.style.transform || 'translate(0, 0)', offset: 0, easing: 'ease-out' },
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
      cancelAnimationFrame(frame)
      clearAnimations()
      rows().forEach((row) => { row.style.transform = '' })
    },
  }
}
