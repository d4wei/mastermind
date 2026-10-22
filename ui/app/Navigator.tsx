import { useTableExpansion } from '../modes/reading/TableExpansion'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useT } from '../i18n'
import { documentViewport, readingLine, scrollToOffset } from '../util/scroll'
import type { OutlineItem } from '../modes/reading/outline'

/** Shared breakpoint for document panels. */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 900px)').matches,
  )
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia('(max-width: 900px)')
    const on = (): void => setNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/** Outline geometry and navigation for Markdown mode, which has no rendered heading elements. */
export interface SourceOutline {
  headingTop(offset: number): number
  scrollTo(offset: number): void
}

export interface NavigatorProps {
  outline: OutlineItem[]
  /** The rendered reading article; null in Markdown mode, which navigates through `source`. */
  docEl: HTMLElement | null
  source: SourceOutline | null
}

export function Navigator({ outline: items, docEl, source: sourceOutline }: NavigatorProps) {
  const { hidden: tableExpanded } = useTableExpansion()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [activeOffset, setActiveOffset] = useState<number | null>(null)
  const container = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => { setActiveOffset(items[0]?.offset ?? null) }, [items])
  useEffect(() => {
    const heads = items.flatMap((item) => {
      if (!docEl) return sourceOutline ? [{ offset: item.offset, top: () => sourceOutline.headingTop(item.offset) }] : []
      const element = docEl.querySelector<HTMLElement>(`[data-ps="${item.offset}"]`)
      return element ? [{ offset: item.offset, top: () => element.getBoundingClientRect().top }] : []
    })
    if (heads.length === 0) return

    let raf = 0
    const update = (): void => {
      raf = 0
      const { scrollTop: y, maxScroll } = documentViewport()
      const line = readingLine() + 24
      const at = heads.map((h) => y + h.top() - line)
      // Spread headings that cannot reach the reading line across the remaining scroll.
      const firstUnreachable = at.findIndex((v) => v > maxScroll)
      if (maxScroll > 0 && firstUnreachable > 0) {
        const base = at[firstUnreachable - 1]!
        const span = maxScroll - base
        const tail = heads.length - firstUnreachable
        for (let i = firstUnreachable; i < heads.length; i++) {
          at[i] = base + (span * (i - firstUnreachable + 1)) / tail
        }
      }
      let active = 0
      for (let i = 0; i < heads.length; i++) {
        if (y >= at[i]! - 1) active = i
        else break
      }
      setActiveOffset(heads[active]!.offset)
    }
    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    const scrollTarget = documentViewport().target
    scrollTarget.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      scrollTarget.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [items, docEl, sourceOutline])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || container.current?.closest('[inert]')) return
      // Document-level Escape handlers skip a prevented Escape.
      event.preventDefault()
      if (container.current?.contains(document.activeElement)) trigger.current?.focus()
      setOpen(false)
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  if (items.length < 2) return null
  const minDepth = Math.min(...items.map((item) => item.depth))
  const barStyle = (item: typeof items[number]): CSSProperties => ({
    '--heading-depth': item.depth - minDepth,
  } as CSSProperties)
  const active = items.find((item) => item.offset === activeOffset) ?? items[0]!
  const go = (offset: number): void => {
    if (docEl) scrollToOffset({ current: docEl }, offset)
    else {
      sourceOutline?.scrollTo(offset)
      setActiveOffset(offset)
    }
    trigger.current?.focus()
    setOpen(false)
  }

  return <nav className="compact-outline" inert={tableExpanded} aria-hidden={tableExpanded || undefined} data-table-hidden={tableExpanded} ref={container} aria-label={t('outline')}
    onPointerEnter={(event) => { if (event.pointerType !== 'touch') setOpen(true) }}
    onPointerLeave={() => { if (!container.current?.contains(document.activeElement)) setOpen(false) }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button type="button" ref={trigger} className="outline-progress" aria-label={`${t('showOutline')}: ${active.text}`}
      aria-expanded={open} aria-controls="heading-list" onFocus={() => setOpen(true)}
      onClick={() => setOpen(true)} style={{ '--heading-count': items.length } as CSSProperties}>
      {items.map((item) => <span key={item.offset} aria-hidden="true"
        className={`outline-tick${item.offset === active.offset ? ' active' : ''}`}
        style={barStyle(item)} />)}
    </button>
    {open && <div className="outline-popover" id="heading-list">
      <ul className="nav-outline">
        {items.map((item) => <li key={item.offset}>
          <button type="button" onClick={() => go(item.offset)} title={item.text}
            onMouseDown={(event) => {
              // Keep WebKit's button blur from dismissing the popup before its click runs.
              if (event.button === 0) event.preventDefault()
            }}
            aria-current={item.offset === active.offset ? 'location' : undefined}
            style={barStyle(item)}>
            <span className="outline-list-tick" aria-hidden="true" />
            <span className="outline-label">{item.text}</span>
          </button>
        </li>)}
      </ul>
    </div>}
  </nav>
}
