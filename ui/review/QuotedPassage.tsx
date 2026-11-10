import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent,
  type RefObject } from 'react'
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
  /** Whether an overflowing passage can expand; while false it only clamps, and an expansion ends. */
  expandable: boolean
  /**
   * How an overflowing passage expands: `disclosure` offers Show more and Show less beneath it;
   * `press` makes the passage itself a control that expands it once, with no way back but
   * `expandable` turning false.
   */
  expansion?: 'disclosure' | 'press'
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
 * can be revealed whole inside the card, through the Show more disclosure or by pressing the passage
 * itself; a new clamp or passage, or the passage ceasing to be expandable, starts it clamped again.
 * Clamp changes ease the passage's height, so an expansion grows downward. The clamp is visual, so
 * assistive technology reads the whole text.
 */
export function QuotedPassage({ text, lines, expandable, expansion: mode = 'disclosure', as: Tag = 'div',
  'aria-label': label }: Props) {
  const t = useT()
  const id = useId()
  const ref = useRef<HTMLElement>(null)
  // A new clamp or passage starts collapsed, as does one no longer expandable; React discards the render that resets it.
  const [expansion, setExpansion] = useState({ text, lines, expanded: false })
  if (expansion.text !== text || expansion.lines !== lines || (!expandable && expansion.expanded)) {
    setExpansion({ text, lines, expanded: false })
  }
  const expanded = expandable && expansion.expanded
  const { drawn, overflows } = useClampTransition(ref, text, { lines, expanded }, expandable)
  const setExpanded = (next: boolean) => setExpansion({ text, lines, expanded: next })
  // A pressable passage stays a control once expanded, out of the tab order, so focus stays on it.
  const pressable = mode === 'press' && expandable && (overflows || expanded)
  const press = pressable && !expanded ? {
    onClick: (event: MouseEvent) => {
      // Dragging to select the passage's text does not expand it.
      if (window.getSelection()?.isCollapsed === false) return
      event.stopPropagation()
      setExpanded(true)
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      setExpanded(true)
    },
  } : {}
  return <>
    <Tag ref={ref as never} id={id} className={`rail-card-anchor${drawn.expanded ? ' expanded' : ''}`}
      style={{ '--quote-lines': drawn.lines } as CSSProperties}
      {...pressable ? { role: 'button', tabIndex: expanded ? -1 : 0, 'aria-expanded': expanded,
        'aria-label': expanded ? label : `${t('quoteShowMore')}: ${text}` } : { 'aria-label': label }}
      {...press}>{text}</Tag>
    {mode === 'disclosure' && <Collapsible open={expandable && (overflows || expanded)} className="rail-quote-reveal">
      <div className="rail-actions rail-footer rail-quote-footer">
        <DisclosureToggle kind="expand" expanded={expanded} controls={id} onToggle={() => setExpanded(!expanded)}>
          {t(expanded ? 'quoteShowLess' : 'quoteShowMore')}
        </DisclosureToggle>
      </div>
    </Collapsible>}
  </>
}
