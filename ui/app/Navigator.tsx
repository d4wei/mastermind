import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useT } from '../i18n'
import { scrollToOffset } from '../util/scroll'
import { useNav } from './navStore'
import { useDoc } from '../documents/store'

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

export function Navigator() {
  const t = useT()
  const items = useNav((s) => s.outline)
  const docEl = useNav((s) => s.docEl)
  const [open, setOpen] = useState(false)
  const [activeOffset, setActiveOffset] = useState<number | null>(null)
  const container = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => { setActiveOffset(items[0]?.offset ?? null) }, [items])
  useEffect(() => {
    if (!docEl) return
    const heads = items
      .map((it) => ({ offset: it.offset, el: docEl.querySelector(`[data-ps="${it.offset}"]`) as HTMLElement | null }))
      .filter((h): h is { offset: number; el: HTMLElement } => h.el !== null)
    if (heads.length === 0) return

    let raf = 0
    const update = (): void => {
      raf = 0
      const y = window.scrollY
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight
      const line = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 72) + 24
      const at = heads.map((h) => y + h.el.getBoundingClientRect().top - line)
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
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [items, docEl])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
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
  const maxSectionLength = Math.max(1, ...items.map((item) => item.sectionLength))
  const barStyle = (item: typeof items[number]): CSSProperties => ({
    '--heading-depth': item.depth - minDepth,
    '--section-weight': Math.sqrt(item.sectionLength / maxSectionLength),
  } as CSSProperties)
  const active = items.find((item) => item.offset === activeOffset) ?? items[0]!
  const go = (offset: number, index: number): void => {
    if (docEl) scrollToOffset({ current: docEl }, offset)
    else {
      useDoc.getState().scroller?.(offset, index)
      setActiveOffset(offset)
    }
    trigger.current?.focus()
    setOpen(false)
  }

  return <nav className="compact-outline" ref={container} aria-label={t('outline')}
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
        {items.map((item, index) => <li key={item.offset}>
          <button type="button" onClick={() => go(item.offset, index)} title={item.text}
            aria-current={item.offset === active.offset ? 'location' : undefined}
            style={barStyle(item)}>
            <span className="outline-list-tick" aria-hidden="true" />{item.text}
          </button>
        </li>)}
      </ul>
    </div>}
  </nav>
}
