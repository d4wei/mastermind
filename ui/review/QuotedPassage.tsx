import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useT } from '../i18n'
import { prefersReducedMotion } from '../util/presence'
import { Collapsible, revealMs } from './Collapsible'
import { DisclosureToggle } from './DisclosureToggle'
import { SETTLES_TO, settledMarginBox } from './settling'

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

interface Clamp { lines: number; expanded: boolean }

/** Draws `clamp` on the passage element and returns a function that restores what was drawn. */
function drawClamp(element: HTMLElement, clamp: Clamp): () => void {
  const lines = element.style.getPropertyValue('--quote-lines')
  const expanded = element.classList.contains('expanded')
  element.style.setProperty('--quote-lines', String(clamp.lines))
  element.classList.toggle('expanded', clamp.expanded)
  return () => { element.style.setProperty('--quote-lines', lines); element.classList.toggle('expanded', expanded) }
}

/** Whether the passage's text runs past the clamp drawn on it. */
function overflowsClamp(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight + 1
}

/**
 * Eases the passage's height between clamps. Line clamping cannot transition, so a new clamp is
 * measured once, in place before paint, and the element's `max-height` animates from the height
 * on screen to the measured one. A growing clamp is drawn at once and revealed; a shrinking one
 * keeps the previous clamp drawn while it closes and takes over when the animation ends, so the
 * ellipsis appears only at the final height, and marks the passage as settling to it. Also reports
 * whether the passage overflows `target`, measured unanimated: with each new clamp, whenever the
 * passage resizes outside an animation, and once an animation ends. Reduced motion, a new text, or
 * a missing token change the clamp at once.
 */
function useClampTransition(ref: RefObject<HTMLElement | null>, text: string, target: Clamp, measure: boolean) {
  const [drawn, setDrawn] = useState(target)
  const [overflows, setOverflows] = useState(false)
  const animation = useRef<Animation | null>(null)
  /** The clamp and text most recently drawn or animated toward. */
  const settled = useRef({ text, ...target })
  const { lines, expanded } = target

  useLayoutEffect(() => {
    const element = ref.current
    const next = { lines, expanded }
    const previous = settled.current
    if (previous.text === text && previous.lines === lines && previous.expanded === expanded) return
    settled.current = { text, ...next }
    if (!element) { setDrawn(next); return }
    const textChanged = previous.text !== text
    // The height on screen, mid-animation included, is where any new animation starts.
    const from = element.getBoundingClientRect().height
    animation.current?.cancel()
    animation.current = null
    element.removeAttribute(SETTLES_TO)
    const restore = drawClamp(element, next)
    const to = element.getBoundingClientRect().height
    if (measure && !expanded) setOverflows(overflowsClamp(element))
    restore()
    const duration = revealMs()
    if (textChanged || from === to || duration <= 0 || prefersReducedMotion() || !element.animate) {
      setDrawn(next)
      return
    }
    if (to > from) setDrawn(next)
    else element.setAttribute(SETTLES_TO, String(settledMarginBox(element, to)))
    const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-standard').trim() || 'ease'
    const running = element.animate([{ maxHeight: `${from}px` }, { maxHeight: `${to}px` }], { duration, easing, fill: 'forwards' })
    animation.current = running
    // The final clamp is committed before the held max-height is released, so no frame shows the
    // previous clamp unheld. A cancelled animation rejects; whatever cancelled it draws the next clamp.
    // Resizes during the animation went unmeasured, so overflow is measured again at its end.
    running.finished.then(() => {
      if (animation.current !== running) return
      animation.current = null
      element.removeAttribute(SETTLES_TO)
      flushSync(() => setDrawn(next))
      running.cancel()
      if (measure && !expanded) setOverflows(overflowsClamp(element))
    }, () => {})
  }, [ref, text, lines, expanded, measure])
  useLayoutEffect(() => () => animation.current?.cancel(), [])

  // Overflow is measured again whenever the card's width or fonts resize the clamped passage.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !measure || drawn.expanded) return
    const check = (): void => { if (!animation.current) setOverflows(overflowsClamp(element)) }
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, measure, drawn.expanded, drawn.lines, text])

  return { drawn, overflows }
}

/**
 * A discussion's quoted passage, clamped to `lines`. An expandable passage that overflows its clamp
 * offers the Show more disclosure, which reveals it whole inside the card; a new clamp or passage
 * starts collapsed. Clamp changes ease the passage's height. The full text stays in the title, and
 * the clamp is visual, so assistive technology reads it all.
 */
export function QuotedPassage({ text, lines, expandable, as: Tag = 'div', 'aria-label': label }: Props) {
  const t = useT()
  const id = useId()
  const ref = useRef<HTMLElement>(null)
  // A new clamp or passage starts collapsed; React discards the render that resets it.
  const [expansion, setExpansion] = useState({ text, lines, expanded: false })
  if (expansion.text !== text || expansion.lines !== lines) setExpansion({ text, lines, expanded: false })
  const expanded = expandable && expansion.expanded
  const { drawn, overflows } = useClampTransition(ref, text, { lines, expanded }, expandable)
  return <>
    <Tag ref={ref as never} id={id} className={`rail-card-anchor${drawn.expanded ? ' expanded' : ''}`}
      aria-label={label} style={{ '--quote-lines': drawn.lines } as CSSProperties}>{text}</Tag>
    <Collapsible open={expandable && (overflows || expanded)} className="rail-quote-reveal">
      <div className="rail-actions rail-footer rail-quote-footer">
        <DisclosureToggle kind="expand" expanded={expanded} controls={id}
          onToggle={() => setExpansion({ text, lines, expanded: !expanded })}>
          {t(expanded ? 'quoteShowLess' : 'quoteShowMore')}
        </DisclosureToggle>
      </div>
    </Collapsible>
  </>
}
