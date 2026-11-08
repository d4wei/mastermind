import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useT } from '../i18n'

interface Props {
  text: string
  /** Lines shown before the passage clamps with an ellipsis. */
  lines: number
  /** A resolved card quotes its passage as a blockquote; a live card's passage is a plain line. */
  as?: 'div' | 'blockquote'
  'aria-label'?: string
}

/**
 * A discussion's quoted passage, clamped to `lines`. Only a passage that overflows its clamp offers
 * Show more, which reveals it whole inside the card; a new clamp or passage starts collapsed. The
 * full text stays in the title, and the clamp is visual, so assistive technology reads it all.
 */
export function QuotedPassage({ text, lines, as: Tag = 'div', 'aria-label': label }: Props) {
  const t = useT()
  const ref = useRef<HTMLElement>(null)
  const [state, setState] = useState({ text, lines, expanded: false })
  if (state.text !== text || state.lines !== lines) setState({ text, lines, expanded: false })
  const expanded = state.expanded && state.text === text && state.lines === lines
  const [overflows, setOverflows] = useState(false)
  // Overflow is measured while clamped, and again whenever the card's width or fonts resize it.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || expanded) return
    const check = (): void => setOverflows(element.scrollHeight > element.clientHeight + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded, text, lines])
  return <>
    <Tag ref={ref as never} className={`rail-card-anchor${expanded ? ' expanded' : ''}`} title={text} aria-label={label}
      style={{ '--quote-lines': lines } as CSSProperties}>{text}</Tag>
    {(overflows || expanded) && <button type="button" className="rail-link rail-quote-toggle" aria-expanded={expanded}
      onClick={() => setState((current) => ({ ...current, expanded: !expanded }))}>
      {t(expanded ? 'quoteShowLess' : 'quoteShowMore')}
    </button>}
  </>
}
