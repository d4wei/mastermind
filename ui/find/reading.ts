import { clearHighlight, paintHighlight } from '../util/highlights'
import { isAscii, TextSearch, type Match } from './matches'

interface Point { node: Text; offset: number }
/**
 * Displayed text of one phrase. Each character starts in the latest segment at or before it, at
 * its recorded offset, and ends one unit later unless collapsed whitespace extended it.
 */
export interface TextRun {
  text: string
  ascii: boolean
  /** The lowercased text, kept from the first case-insensitive search. */
  folded?: string
  segments: { node: Text; from: number }[]
  offsets: number[]
  extendedEnds: Map<number, Point>
}
interface ReadingMatch extends Match { range: Range }

const blocks = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'DIV', 'SECTION', 'ARTICLE'])
const excluded = 'button, input, textarea, select, script, style, [hidden], [aria-hidden="true"], .print-footnotes, .rail-card-anchor, .rail-author'
const preserved = 'pre, .rail-body'
const whitespace = /\s+/g
// Find's own controls and the outline strip change without changing searchable content.
const unsearched = '.find-bar, .compact-outline'

function emptyRun(): TextRun {
  return { text: '', ascii: true, segments: [], offsets: [], extendedEnds: new Map() }
}

/** Inline text shares a run; block boundaries and excluded chrome never join searchable phrases. */
export function readingRuns(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = []
  let run = emptyRun()
  const flush = () => {
    if (run.text) { run.ascii = isAscii(run.text); runs.push(run) }
    run = emptyRun()
  }
  const append = (node: Text, text: string, from: number) => {
    if (run.segments.at(-1)?.node !== node) run.segments.push({ node, from: run.text.length })
    run.text += text
    for (let i = 0; i < text.length; i++) run.offsets.push(from + i)
  }
  const appendText = (node: Text, preserve: boolean) => {
    const data = node.data
    if (preserve) { append(node, data, 0); return }
    let at = 0
    for (const space of data.matchAll(whitespace)) {
      if (space.index > at) append(node, data.slice(at, space.index), at)
      const end = space.index + space[0].length
      // Collapsed whitespace displays as one space whose range covers every whitespace unit.
      if (run.text.endsWith(' ')) run.extendedEnds.set(run.text.length - 1, { node, offset: end })
      else {
        append(node, ' ', space.index)
        if (end > space.index + 1) run.extendedEnds.set(run.text.length - 1, { node, offset: end })
      }
      at = end
    }
    if (at < data.length) append(node, data.slice(at), at)
  }
  const walk = (node: Node, preserve: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) { appendText(node as Text, preserve); return }
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) return
    if (node.matches(excluded)) { flush(); return }
    const boundary = blocks.has(node.tagName) || node.tagName === 'BR'
    const inner = preserve || node.matches(preserved)
    if (boundary) flush()
    for (let child = node.firstChild; child; child = child.nextSibling) walk(child, inner)
    if (boundary) flush()
  }
  walk(root, !!root.parentElement?.closest(preserved))
  flush()
  return runs
}

function startPoint(run: TextRun, index: number): Point {
  let low = 0, high = run.segments.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (run.segments[mid]!.from <= index) low = mid
    else high = mid - 1
  }
  return { node: run.segments[low]!.node, offset: run.offsets[index]! }
}

function runRange(run: TextRun, match: Match): Range {
  const start = startPoint(run, match.from)
  const last = match.to - 1
  const end = run.extendedEnds.get(last) ?? { node: startPoint(run, last).node, offset: run.offsets[last]! + 1 }
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

export function runMatches(runs: readonly TextRun[], search: TextSearch): ReadingMatch[] {
  const results: ReadingMatch[] = []
  for (const run of runs) {
    const folded = run.ascii && !search.caseSensitive ? run.folded ??= run.text.toLowerCase() : undefined
    for (const match of search.matches(run.text, run.ascii, folded)) results.push({ ...match, range: runRange(run, match) })
  }
  return results
}

export function readingMatches(root: HTMLElement, query: string, caseSensitive: boolean): ReadingMatch[] {
  return runMatches(readingRuns(root), new TextSearch(query, caseSensitive))
}

/**
 * Holds one root's runs until the DOM inside it changes, and reports every searchable change in
 * `scope`: one outside the root, such as rail cards mounting as the document scrolls, repaints
 * Find without walking the root again. Mutations are taken synchronously when runs are requested,
 * so a commit that has not yet notified the observer still invalidates them.
 */
export class ReadingIndex {
  private cached: TextRun[] | null = null
  private readonly observer: MutationObserver

  constructor(readonly root: HTMLElement, scope: Node, onChange: () => void) {
    this.observer = new MutationObserver((records) => { if (this.absorb(records)) onChange() })
    this.observer.observe(scope, { childList: true, subtree: true, characterData: true })
  }

  runs(): TextRun[] {
    this.absorb(this.observer.takeRecords())
    return this.cached ??= readingRuns(this.root)
  }

  disconnect(): void {
    this.observer.disconnect()
    this.cached = null
  }

  private absorb(records: MutationRecord[]): boolean {
    const searched = records.filter(({ target }) => !(target instanceof Element ? target : target.parentElement)?.closest(unsearched))
    if (!searched.length) return false
    if (searched.some(({ target }) => this.root.contains(target))) this.cached = null
    return true
  }
}

/** Comment offsets refer to the displayed body, including its preserved paragraph breaks. */
export function commentRange(root: HTMLElement, match: Match): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let start: Point | null = null
  let end: Point | null = null
  for (let seen = 0, node = walker.nextNode() as Text | null; node; seen += node.length, node = walker.nextNode() as Text | null) {
    if (!start && match.from < seen + node.length) start = { node, offset: match.from - seen }
    if (start && match.to <= seen + node.length) { end = { node, offset: match.to - seen }; break }
  }
  if (!start || !end) return null
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

export function paintMatches(ranges: Range[], current: Range | null): void {
  paintHighlight('find-results', ranges)
  paintHighlight('find-current', current ? [current.cloneRange()] : [])
}

export function clearMatches(): void {
  clearHighlight('find-results')
  clearHighlight('find-current')
}

export function revealMatch(range: Range, panel: HTMLElement | null): void {
  const element = range.startContainer.parentElement
  const table = element?.closest<HTMLElement>('.md-table-scroll')
  if (table) {
    const match = range.getBoundingClientRect()
    const bounds = table.getBoundingClientRect()
    if (match.left < bounds.left) table.scrollLeft += match.left - bounds.left
    else if (match.right > bounds.right) {
      table.scrollLeft += Math.min(match.right - bounds.right, match.left - bounds.left)
    }
  }
  const scroller = element?.closest<HTMLElement>('.slide-over-body, .document-scroll')
  if (!scroller) return
  const rect = range.getBoundingClientRect()
  const viewport = scroller.getBoundingClientRect()
  const cover = panel?.getBoundingClientRect()
  const overlaps = cover && rect.right > cover.left && rect.left < cover.right
  const top = overlaps ? Math.max(viewport.top, cover.bottom) : viewport.top
  const padding = 12
  if (rect.top < top + padding) scroller.scrollTop += rect.top - top - padding
  else if (rect.bottom > viewport.bottom - padding) scroller.scrollTop += rect.bottom - viewport.bottom + padding
}
