import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useT } from '../i18n'
import { DisclosureToggle } from './DisclosureToggle'

interface Props {
  text: string
  /** Lines shown before the passage clamps with an ellipsis. */
  lines: number
  /** Whether an overflowing passage offers its disclosure; an unselected live card only clamps. */
  expandable: boolean
  /** A resolved card quotes its passage as a blockquote; a live card's passage is a plain line. */
  as?: 'div' | 'blockquote'
  'aria-label'?: string
}

/**
 * A discussion's quoted passage, clamped to `lines`. An expandable passage that overflows its clamp
 * offers the Full passage disclosure, which reveals it whole inside the card; a new clamp or passage
 * starts collapsed. The full text stays in the title, and the clamp is visual, so assistive
 * technology reads it all.
 */
export function QuotedPassage({ text, lines, expandable, as: Tag = 'div', 'aria-label': label }: Props) {
  const t = useT()
  const id = useId()
  const ref = useRef<HTMLElement>(null)
  const [state, setState] = useState({ text, lines, expanded: false })
  if (state.text !== text || state.lines !== lines) setState({ text, lines, expanded: false })
  const expanded = expandable && state.expanded && state.text === text && state.lines === lines
  const [overflows, setOverflows] = useState(false)
  // Overflow is measured while clamped, and again whenever the card's width or fonts resize it.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || expanded || !expandable) return
    const check = (): void => setOverflows(element.scrollHeight > element.clientHeight + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded, expandable, text, lines])
  return <>
    <Tag ref={ref as never} id={id} className={`rail-card-anchor${expanded ? ' expanded' : ''}`} title={text}
      aria-label={label} style={{ '--quote-lines': lines } as CSSProperties}>{text}</Tag>
    {expandable && (overflows || expanded) && <div className="rail-actions rail-footer rail-quote-footer">
      <DisclosureToggle expanded={expanded} controls={id}
        onToggle={() => setState((current) => ({ ...current, expanded: !expanded }))}>
        {t('quoteFull')}
      </DisclosureToggle>
    </div>}
  </>
}
