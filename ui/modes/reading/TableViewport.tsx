import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Tooltip } from 'radix-ui'
import { useT } from '../../i18n'
import { ExpandIcon, CollapseIcon } from '../../icons'
import { READING_LAYOUT_EVENT } from '../../app/reading-space'
import { ESCAPE_OWNER_SELECTOR, escapeOwner } from '../../app/constants'
import { useTableExpansion } from './TableExpansion'
import { prefersReducedMotion } from '../../util/presence'
import { isImeKey } from '../../util/composition'
import { cssMs, cssPx } from '../../util/css-tokens'

/** Dispatched on `window` after a table batch or an expansion frame changes a table's layout. */
export const TABLE_LAYOUT_EVENT = 'mastermind-table-layout'

interface Geometry { left: number; width: number }

/** The inputs one table is sized against, read before any table is written. */
interface Sizing { width: number; available: number; edge: number; scrollbar: number; key: string }

interface Placement { sizing: Sizing; resized: boolean; gap: number; hostLeft: number; containerLeft: number; height: number }

/** One registered table. The batch sizes it; `place` and `readEdges` apply the result to its frame. */
interface TableLayout {
  readonly host: HTMLElement
  readonly container: HTMLElement
  readonly table: HTMLElement
  readonly scroll: HTMLElement
  /** The sizing key the table was last sized against; empty forces sizing on the next batch. */
  sizedFor: string
  tableWidth: number
  gap: number
  /** Applies a measurement; writes only, apart from an immediate collapse. */
  place(placement: Placement): void
  /** Reads the scroll extents and returns the edge-fade write. */
  readEdges(): () => void
}

const tables = new Set<TableLayout>()
const pending = new Set<TableLayout>()
const byContainer = new Map<Element, Set<TableLayout>>()
const byElement = new Map<Element, TableLayout>()
let flushQueued = false
let observer: ResizeObserver | null = null

/**
 * Measures tables in phases, each phase across every table before the next, so layout is forced
 * once per phase rather than once per table.
 */
function measureTables(layouts: Iterable<TableLayout>): void {
  const batch: { layout: TableLayout; sizing: Sizing; resized: boolean }[] = []
  for (const layout of layouts) {
    const { host, container } = layout
    if (!host.isConnected || !host.clientWidth) continue
    const css = getComputedStyle(host)
    const edge = cssPx(css, '--reading-edge')
    const available = container.clientWidth - edge * 2
    const key = `${host.clientWidth}:${available}:${css.font}:${css.letterSpacing}`
    batch.push({ layout, resized: key !== layout.sizedFor,
      sizing: { width: host.clientWidth, available, edge, scrollbar: cssPx(css, '--document-scrollbar-size'), key } })
  }
  const resized = batch.filter((entry) => entry.resized)
  // Size against expanded space once; changing the clipping viewport must not reflow cells.
  for (const { layout, sizing } of resized) {
    layout.table.style.width = 'max-content'
    layout.table.style.maxWidth = `${sizing.available}px`
  }
  for (const { layout } of resized) layout.tableWidth = layout.table.getBoundingClientRect().width
  for (const { layout, sizing } of resized) {
    layout.table.style.width = `${layout.tableWidth}px`
    layout.table.style.maxWidth = 'none'
    layout.sizedFor = sizing.key
  }
  const placements = batch.map(({ layout, sizing, resized }) => {
    // The scroll gap is a calc() token, so read it resolved from the scroller's padding.
    if (resized) layout.gap = parseFloat(getComputedStyle(layout.scroll).paddingBottom) || 0
    return { layout, placement: { sizing, resized, gap: layout.gap, hostLeft: layout.host.getBoundingClientRect().left,
      containerLeft: layout.container.getBoundingClientRect().left, height: layout.table.getBoundingClientRect().height } }
  })
  for (const { layout, placement } of placements) layout.place(placement)
  const edges = placements.map(({ layout }) => layout.readEdges())
  for (const write of edges) write()
  if (batch.length) window.dispatchEvent(new Event(TABLE_LAYOUT_EVENT))
}

function flushPending(): void {
  flushQueued = false
  if (!pending.size) return
  const batch = [...pending]
  pending.clear()
  // Expandability is React state; committing it with the batch keeps the control in the same frame.
  flushSync(() => measureTables(batch))
}

/**
 * Queues a table for one batch that runs after the current task's script, before the frame paints:
 * after a commit's effects, an event's other listeners, or the resize observations of a frame.
 */
function scheduleMeasure(layout: TableLayout): void {
  pending.add(layout)
  if (flushQueued) return
  flushQueued = true
  queueMicrotask(flushPending)
}

function measureAll(): void {
  tables.forEach(scheduleMeasure)
}

function remeasureAll(): void {
  for (const layout of tables) layout.sizedFor = ''
  measureAll()
}

function onResize(entries: ResizeObserverEntry[]): void {
  for (const { target } of entries) {
    byContainer.get(target)?.forEach(scheduleMeasure)
    const layout = byElement.get(target)
    if (layout) scheduleMeasure(layout)
  }
}

function register(layout: TableLayout): void {
  if (!tables.size) {
    observer = new ResizeObserver(onResize)
    window.addEventListener('resize', measureAll)
    window.addEventListener(READING_LAYOUT_EVENT, measureAll)
    // A web font finishing its load changes metrics without changing the computed font.
    document.fonts?.addEventListener?.('loadingdone', remeasureAll)
  }
  tables.add(layout)
  byElement.set(layout.host, layout).set(layout.table, layout)
  observer!.observe(layout.host)
  observer!.observe(layout.table)
  const shared = byContainer.get(layout.container)
  if (shared) shared.add(layout)
  else {
    byContainer.set(layout.container, new Set([layout]))
    observer!.observe(layout.container)
  }
}

function unregister(layout: TableLayout): void {
  tables.delete(layout)
  pending.delete(layout)
  byElement.delete(layout.host)
  byElement.delete(layout.table)
  observer?.unobserve(layout.host)
  observer?.unobserve(layout.table)
  const shared = byContainer.get(layout.container)
  shared?.delete(layout)
  if (shared && !shared.size) {
    byContainer.delete(layout.container)
    observer?.unobserve(layout.container)
  }
  if (tables.size) return
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', measureAll)
  window.removeEventListener(READING_LAYOUT_EVENT, measureAll)
  document.fonts?.removeEventListener?.('loadingdone', remeasureAll)
}

/**
 * `contentKey` identifies what the table renders, so only a changed table is measured again;
 * `source` is the whole document, whose every change releases an expansion.
 */
export function TableViewport({ children, contentKey, source }: { children: ReactNode; contentKey: string; source?: string }) {
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
  const layout = useRef<TableLayout | null>(null)

  useLayoutEffect(() => {
    const host = slot.current!
    const view = viewport.current!
    const scroll = scroller.current!
    const table = scroll.querySelector('table')!
    const container = host.closest<HTMLElement>('.document-scroll') ?? document.documentElement
    const readEdges = () => {
      const overflow = scroll.scrollWidth - scroll.clientWidth > 1
      const left = overflow && scroll.scrollLeft > 1
      const right = overflow && scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 1
      return () => {
        scroll.dataset.overflow = String(overflow)
        view.dataset.left = String(left)
        view.dataset.right = String(right)
      }
    }
    const edges = () => readEdges()()
    const setGeometry = (next: Geometry, offset?: number) => {
      geometry.current = next
      view.style.width = `${next.width}px`
      view.style.marginLeft = `${next.left}px`
      if (offset !== undefined) scroll.scrollLeft = offset
    }
    const paint = (next: Geometry, offset?: number) => {
      setGeometry(next, offset)
      edges()
      window.dispatchEvent(new Event(TABLE_LAYOUT_EVENT))
    }
    const release = () => end(owner.current)
    change.current = (next, immediate = false, focus = false) => {
      if (pending.has(entry)) { pending.delete(entry); measureTables([entry]) }
      if (next && !isExpanded.current && !animation.current) savedScroll.current = scroll.scrollLeft
      cancelAnimationFrame(animation.current)
      isExpanded.current = next
      setExpanded(next)
      if (next) begin(owner.current)
      const target = next ? bounds.current.wide : bounds.current.normal
      const from = { ...geometry.current, scroll: scroll.scrollLeft }
      const offset = Math.min(next ? from.scroll : savedScroll.current, Math.max(0, table.offsetWidth - target.width))
      const ms = cssMs(getComputedStyle(host), '--dur-fade')
      const time = immediate || prefersReducedMotion() || ms === null ? 0 : ms
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
    const entry: TableLayout = {
      host, container, table, scroll, sizedFor: '', tableWidth: 0, gap: 0, readEdges,
      place({ sizing, resized, gap, hostLeft, containerLeft, height }) {
        const { width, available, edge, scrollbar } = sizing
        if (resized) {
          const canExpand = entry.tableWidth > width + 1 && available > width + 1
          setExpandable(canExpand)
          if (!canExpand && isExpanded.current) change.current(false, true)
        }
        // An expanded table narrower than the window centers on the reading column, kept within
        // the window's edges.
        const wideWidth = Math.min(available, Math.max(entry.tableWidth, width))
        const minLeft = containerLeft + edge - hostLeft
        const wideLeft = Math.min(Math.max((width - wideWidth) / 2, minLeft), minLeft + available - wideWidth)
        const previous = bounds.current
        bounds.current = { normal: { left: 0, width }, wide: { left: wideLeft, width: wideWidth } }
        const boundsChanged = previous.normal.width !== width ||
          previous.wide.width !== wideWidth || previous.wide.left !== wideLeft
        view.style.height = `${height + gap + scrollbar}px`
        if (boundsChanged && animation.current) change.current(isExpanded.current, true)
        if (!animation.current) setGeometry(isExpanded.current ? bounds.current.wide : bounds.current.normal)
      },
    }
    layout.current = entry
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isExpanded.current || event.defaultPrevented || isImeKey(event)) return
      if (escapeOwner(`.sel-toolbar, ${ESCAPE_OWNER_SELECTOR}`)) return
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable=true], [role=dialog]')) return
      event.preventDefault()
      change.current(false, false, true)
    }
    register(entry)
    scroll.addEventListener('scroll', edges, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      unregister(entry)
      layout.current = null
      cancelAnimationFrame(animation.current)
      animation.current = 0
      isExpanded.current = false
      setExpanded(false)
      release()
      scroll.removeEventListener('scroll', edges)
      window.removeEventListener('keydown', onKey)
    }
  }, [begin, end])

  // Declared after registration so a newly mounted table is registered before it is queued.
  useLayoutEffect(() => {
    const entry = layout.current
    if (!entry) return
    entry.sizedFor = ''
    scheduleMeasure(entry)
  }, [contentKey, begin, end])

  const releaseKey = source ?? contentKey
  const seenRelease = useRef(releaseKey)
  useLayoutEffect(() => {
    if (seenRelease.current === releaseKey) return
    seenRelease.current = releaseKey
    if (isExpanded.current || animation.current) change.current(false, true)
  }, [releaseKey])

  const label = t(expanded ? 'collapseTable' : 'expandTable')
  return <div className="md-table-block" ref={slot} data-expandable={expandable} data-expanded={expanded}>
    <div className="md-table-viewport" ref={viewport}>
      {expandable && <Tooltip.Root><Tooltip.Trigger asChild>
        <button type="button" ref={button} className="btn-ghost btn-icon md-table-toggle"
          aria-label={label} aria-expanded={expanded} onClick={() => change.current(!isExpanded.current)}>
          {expanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content data-keeps-discussion="" className="tooltip" side="top" sideOffset={4}>
        {label}<Tooltip.Arrow className="tooltip-arrow" />
      </Tooltip.Content></Tooltip.Portal></Tooltip.Root>}
      <div className="md-table-scroll" ref={scroller} role="region" aria-label={t('table')} tabIndex={0}>
        {children}
      </div>
      <span className="md-table-edge md-table-edge-left" aria-hidden="true" />
      <span className="md-table-edge md-table-edge-right" aria-hidden="true" />
    </div>
  </div>
}
