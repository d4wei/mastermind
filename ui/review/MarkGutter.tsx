import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { documentViewport, scrollToSpan } from '../util/scroll'

export interface MarkTick {
  spanIndex: number
  kind: 'ins' | 'del' | 'sub' | 'comment'
}

interface PlacedTick extends MarkTick {
  fraction: number // 0..1 down the document
}

interface Props {
  docRef: RefObject<HTMLElement | null>
  marks: MarkTick[]
  /** bumped when the buffer changes from outside the renderer — re-measure */
  version: number
}

const KIND_CLASS: Record<MarkTick['kind'], string> = {
  ins: 'tick-ins',
  del: 'tick-del',
  sub: 'tick-sub',
  comment: 'tick-comment',
}

export function MarkGutter({ docRef, marks, version }: Props) {
  const [ticks, setTicks] = useState<PlacedTick[]>([])
  const thumbRef = useRef<HTMLDivElement>(null)
  const metrics = useRef({ articleTop: 0, articleHeight: 1 })

  const measure = useCallback(() => {
    const doc = docRef.current
    if (!doc) return
    const viewport = documentViewport()
    const articleTop = doc.getBoundingClientRect().top - viewport.top + viewport.scrollTop
    const articleHeight = doc.offsetHeight || 1
    metrics.current = { articleTop, articleHeight }
    const placed: PlacedTick[] = []
    for (const m of marks) {
      const el = doc.querySelector(`[data-span-index="${m.spanIndex}"]`)
      if (!el) continue
      const top = el.getBoundingClientRect().top - doc.getBoundingClientRect().top
      placed.push({ ...m, fraction: Math.min(1, Math.max(0, top / articleHeight)) })
    }
    // Coalesce nearby marks to keep dense documents legible.
    placed.sort((a, b) => a.fraction - b.fraction)
    const clustered: PlacedTick[] = []
    for (const tk of placed) {
      const last = clustered[clustered.length - 1]
      if (!last || tk.fraction - last.fraction > 0.006) clustered.push(tk)
    }
    setTicks(clustered)
  }, [docRef, marks])

  useEffect(() => {
    let raf = 0
    const schedule = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    schedule()
    const ro = new ResizeObserver(schedule)
    if (docRef.current) ro.observe(docRef.current)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [measure, version])

  useEffect(() => {
    const onScroll = (): void => {
      const thumb = thumbRef.current
      if (!thumb) return
      const { articleTop, articleHeight } = metrics.current
      const viewport = documentViewport()
      const topFrac = Math.max(0, (viewport.scrollTop - articleTop) / articleHeight)
      const heightFrac = Math.min(1, viewport.height / articleHeight)
      thumb.style.transform = `translateY(${topFrac * 100}%)`
      thumb.style.height = `${heightFrac * 100}%`
    }
    onScroll()
    const scrollTarget = documentViewport().target
    scrollTarget.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollTarget.removeEventListener('scroll', onScroll)
  }, [ticks])

  if (ticks.length === 0) return null

  return (
    <div
      className="mark-gutter"
      aria-hidden
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const f = (e.clientY - rect.top) / rect.height
        let nearest = ticks[0]!
        for (const tk of ticks) if (Math.abs(tk.fraction - f) < Math.abs(nearest.fraction - f)) nearest = tk
        scrollToSpan(docRef, nearest.spanIndex)
      }}
    >
      <div ref={thumbRef} className="mark-gutter-thumb" />
      {ticks.map((tk, i) => (
        <span key={i} className={`mark-tick ${KIND_CLASS[tk.kind]}`} style={{ top: `${tk.fraction * 100}%` }} />
      ))}
    </div>
  )
}
