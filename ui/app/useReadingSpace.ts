import { useLayoutEffect, useRef, useState } from 'react'
import { useConfig } from './configStore'
import { DEFAULT_CONFIG } from '../settings/defaults'
import { READING_LAYOUT_EVENT, readingSpace, type ReadingSpace } from './reading-space'
import { prefersReducedMotion } from '../util/presence'
import { cssMs, cssPx } from '../util/css-tokens'

/** `outline` says whether the outline strip is shown and reserves its width. */
export function useReadingSpace(outline: boolean) {
  const [element, ref] = useState<HTMLDivElement | null>(null)
  const config = useConfig((s) => s.config)
  const [space, setSpace] = useState<ReadingSpace | null>(null)
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const css = getComputedStyle(element)
      const px = (name: string) => cssPx(css, name)
      const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const next = {
        viewport: element.parentElement!.clientWidth,
        preferred: (config?.contentWidth ?? DEFAULT_CONFIG.contentWidth) * rootSize / 16,
        minimum: (config?.fontSize ?? DEFAULT_CONFIG.fontSize) * rootSize / 16 * px('--reading-min-em'),
        edge: px('--reading-edge'), outline: outline ? px('--reading-outline') : 0,
        rail: px('--reading-rail'), gap: px('--reading-gap'),
      }
      // Wait for a visible scroller and loaded theme before replacing the fallback layout.
      if (next.viewport && next.rail) setSpace((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element.parentElement!)
    document.getElementById('theme-tokens')?.addEventListener('load', measure)
    return () => {
      observer.disconnect()
      document.getElementById('theme-tokens')?.removeEventListener('load', measure)
    }
  }, [element, config?.contentWidth, config?.fontSize, config?.theme, outline])
  return { ref, element, space, panel: space ? readingSpace(space, true).panel : false }
}

export function useReadingMovement(element: HTMLDivElement | null, left: number | undefined, rail: boolean) {
  const previous = useRef<{ left: number; rail: boolean } | null>(null)
  const animation = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    const old = previous.current
    previous.current = left === undefined ? null : { left, rail }
    animation.current?.cancel()
    const notify = () => window.dispatchEvent(new Event(READING_LAYOUT_EVENT))
    notify()
    // Ref state can still hold the removed document shell during the closing render's layout effects.
    if (!element?.isConnected || left === undefined || !old || old.rail === rail || old.left === left ||
      !element.animate || prefersReducedMotion()) return
    const css = getComputedStyle(element)
    const durationMs = cssMs(css, '--dur-base')
    const column = element.querySelector<HTMLElement>('.doc-column')
    if (durationMs === null || !column?.animate) return
    animation.current = column.animate([
      { transform: `translateX(${old.left - left}px)` }, { transform: 'translateX(0)' },
    ], { duration: durationMs, easing: css.getPropertyValue('--ease-out').trim() })
    let frame = 0
    const follow = () => {
      notify()
      if (animation.current?.playState === 'running') frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    animation.current.onfinish = notify
    return () => { cancelAnimationFrame(frame); animation.current?.cancel() }
  }, [element, left, rail])
}
