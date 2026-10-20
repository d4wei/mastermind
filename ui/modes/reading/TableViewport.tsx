import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from 'radix-ui'
import { useT } from '../../i18n'
import { ExpandIcon, CollapseIcon } from '../../icons'
import { READING_LAYOUT_EVENT } from '../../app/reading-space'
import { useTableExpansion } from './TableExpansion'

interface Geometry { left: number; width: number }

export function TableViewport({ children, contentKey }: { children: ReactNode; contentKey: string }) {
  const t = useT()
  const { begin, end } = useTableExpansion()
  const slot = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const [expandable, setExpandable] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const isExpanded = useRef(false)
  const animation = useRef(0)
  const savedScroll = useRef(0)
  const geometry = useRef<Geometry>({ left: 0, width: 0 })
  const bounds = useRef({ normal: { left: 0, width: 0 }, wide: { left: 0, width: 0 } })
  const owner = useRef({ close: () => {} })
  const change = useRef((_expanded: boolean, _immediate = false, _focus = false) => {})

  useLayoutEffect(() => {
    const host = slot.current!
    const view = viewport.current!
    const scroll = scroller.current!
    const table = scroll.querySelector('table')!
    const documentScroll = host.closest<HTMLElement>('.document-scroll')
    const container = documentScroll ?? document.documentElement
    let lastSizing = ''
    let disposed = false
    const edges = () => {
      const overflow = scroll.scrollWidth - scroll.clientWidth > 1
      scroll.dataset.overflow = String(overflow)
      view.dataset.left = String(overflow && scroll.scrollLeft > 1)
      view.dataset.right = String(overflow && scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 1)
    }
    const paint = (next: Geometry, offset?: number) => {
      geometry.current = next
      view.style.width = `${next.width}px`
      view.style.marginLeft = `${next.left}px`
      if (offset !== undefined) scroll.scrollLeft = offset
      edges()
      window.dispatchEvent(new Event('mastermind-table-layout'))
    }
    const release = () => end(owner.current)
    change.current = (next, immediate = false, focus = false) => {
      if (next && !isExpanded.current && !animation.current) savedScroll.current = scroll.scrollLeft
      cancelAnimationFrame(animation.current)
      isExpanded.current = next
      setExpanded(next)
      if (next) begin(owner.current)
      const target = next ? bounds.current.wide : bounds.current.normal
      const from = { ...geometry.current, scroll: scroll.scrollLeft }
      const offset = Math.min(next ? from.scroll : savedScroll.current, Math.max(0, table.offsetWidth - target.width))
      const css = getComputedStyle(host)
      const duration = css.getPropertyValue('--dur-fade').trim()
      const ms = parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000)
      const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
      const time = immediate || reduced || !Number.isFinite(ms) ? 0 : ms
      const start = performance.now()
      const step = (now: number) => {
        const progress = time ? Math.min(1, (now - start) / time) : 1
        const eased = 1 - (1 - progress) ** 3
        paint({ left: from.left + (target.left - from.left) * eased,
          width: from.width + (target.width - from.width) * eased }, from.scroll + (offset - from.scroll) * eased)
        if (progress < 1) animation.current = requestAnimationFrame(step)
        else {
          animation.current = 0
          if (!next) release()
          if (focus) button.current?.focus({ preventScroll: true })
        }
      }
      if (time) animation.current = requestAnimationFrame(step)
      else step(start)
    }
    owner.current.close = () => change.current(false, true)
    const measure = () => {
      if (disposed || !host.isConnected || !host.clientWidth) return
      const css = getComputedStyle(host)
      const edge = parseFloat(css.getPropertyValue('--reading-edge')) || 0
      const hostRect = host.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const available = container.clientWidth - edge * 2
      const previous = bounds.current
      bounds.current = { normal: { left: 0, width: host.clientWidth },
        wide: { left: containerRect.left + edge - hostRect.left, width: available } }
      const boundsChanged = previous.normal.width !== host.clientWidth ||
        previous.wide.width !== available || previous.wide.left !== bounds.current.wide.left
      const sizing = `${host.clientWidth}:${available}:${css.font}:${css.letterSpacing}`
      if (sizing !== lastSizing) {
        lastSizing = sizing
        // Size against expanded space once; changing the clipping viewport must not reflow cells.
        table.style.width = 'max-content'
        table.style.maxWidth = `${available}px`
        const width = table.getBoundingClientRect().width
        table.style.width = `${width}px`
        table.style.maxWidth = 'none'
        const canExpand = width > host.clientWidth + 1 && available > host.clientWidth + 1
        setExpandable(canExpand)
        if (!canExpand && isExpanded.current) change.current(false, true)
      }
      const scrollbar = parseFloat(css.getPropertyValue('--document-scrollbar-size')) || 0
      view.style.height = `${table.getBoundingClientRect().height + scrollbar}px`
      if (boundsChanged && animation.current) change.current(isExpanded.current, true)
      if (!animation.current) paint(isExpanded.current ? bounds.current.wide : bounds.current.normal)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isExpanded.current || event.defaultPrevented || event.isComposing) return
      if (document.querySelector('.sel-toolbar, .settings-panel, .close-dialog[open]')) return
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable=true], [role=dialog]')) return
      event.preventDefault()
      change.current(false, false, true)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    observer.observe(container)
    observer.observe(table)
    scroll.addEventListener('scroll', edges, { passive: true })
    window.addEventListener('resize', measure)
    window.addEventListener(READING_LAYOUT_EVENT, measure)
    window.addEventListener('keydown', onKey)
    document.fonts?.ready.then(() => { if (!disposed) { lastSizing = ''; measure() } })
    return () => {
      disposed = true
      observer.disconnect()
      cancelAnimationFrame(animation.current)
      animation.current = 0
      isExpanded.current = false
      setExpanded(false)
      release()
      scroll.removeEventListener('scroll', edges)
      window.removeEventListener('resize', measure)
      window.removeEventListener(READING_LAYOUT_EVENT, measure)
      window.removeEventListener('keydown', onKey)
    }
  }, [contentKey, begin, end])

  const label = t(expanded ? 'collapseTable' : 'expandTable')
  return <div className="md-table-block" ref={slot} data-expandable={expandable} data-expanded={expanded}>
    <div className="md-table-viewport" ref={viewport}>
      {expandable && <Tooltip.Root><Tooltip.Trigger asChild>
        <button type="button" ref={button} className="btn-ghost btn-icon md-table-toggle"
          aria-label={label} aria-expanded={expanded} onClick={() => change.current(!isExpanded.current)}>
          {expanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" side="top" sideOffset={4}>
        {label}<Tooltip.Arrow />
      </Tooltip.Content></Tooltip.Portal></Tooltip.Root>}
      <div className="md-table-scroll" ref={scroller} role="region" aria-label={t('table')} tabIndex={0}>
        {children}
      </div>
      <span className="md-table-edge md-table-edge-left" aria-hidden="true" />
      <span className="md-table-edge md-table-edge-right" aria-hidden="true" />
    </div>
  </div>
}
