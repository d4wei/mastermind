import { textMatches, type Match } from './matches'

interface Point { node: Text; offset: number }
export interface TextRun { text: string; starts: Point[]; ends: Point[] }
export interface ReadingMatch extends Match { range: Range }

const blocks = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'DIV', 'SECTION', 'ARTICLE'])
const excluded = 'button, input, textarea, select, script, style, [hidden], [aria-hidden="true"], .print-footnotes, .rail-card-anchor, .rail-author'

/** Inline text shares a run; block boundaries and excluded chrome never join searchable phrases. */
export function readingRuns(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = []
  let run: TextRun = { text: '', starts: [], ends: [] }
  const flush = () => {
    if (run.text) runs.push(run)
    run = { text: '', starts: [], ends: [] }
  }
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text
      const preserve = !!text.parentElement?.closest('pre, .rail-body')
      for (let i = 0; i < text.data.length; i++) {
        const char = !preserve && /\s/.test(text.data[i]!) ? ' ' : text.data[i]!
        if (!preserve && char === ' ' && run.text.endsWith(' ')) {
          run.ends[run.ends.length - 1] = { node: text, offset: i + 1 }
          continue
        }
        run.text += char
        run.starts.push({ node: text, offset: i })
        run.ends.push({ node: text, offset: i + 1 })
      }
      return
    }
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) return
    if (node.matches(excluded)) { flush(); return }
    const boundary = blocks.has(node.tagName) || node.tagName === 'BR'
    if (boundary) flush()
    node.childNodes.forEach(walk)
    if (boundary) flush()
  }
  walk(root)
  flush()
  return runs
}

export function runRange(run: TextRun, match: Match): Range {
  const start = run.starts[match.from]!
  const end = run.ends[match.to - 1]!
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

export function readingMatches(root: HTMLElement, query: string, caseSensitive: boolean): ReadingMatch[] {
  return readingRuns(root).flatMap((run) => textMatches(run.text, query, caseSensitive)
    .map((match) => ({ ...match, range: runRange(run, match) })))
}

/** Comment offsets refer to the displayed body, including its preserved paragraph breaks. */
export function commentRange(root: HTMLElement, match: Match): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const points: Point[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node as Text
    for (let i = 0; i < text.length; i++) points.push({ node: text, offset: i })
  }
  const start = points[match.from], end = points[match.to - 1]
  if (!start || !end) return null
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + 1)
  return range
}

export function paintMatches(ranges: Range[], current: Range | null): void {
  if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return
  for (const [name, members] of [
    ['find-results', ranges],
    ['find-current', current ? [current.cloneRange()] : []],
  ] as const) {
    // Mutate registered sets so WebKit invalidates the removed ranges when a query changes.
    const highlight = CSS.highlights.get(name) ?? new Highlight()
    highlight.clear()
    for (const range of members) highlight.add(range)
    CSS.highlights.set(name, highlight)
  }
}

export function clearMatches(): void {
  for (const name of ['find-results', 'find-current']) {
    globalThis.CSS?.highlights?.get(name)?.clear()
    globalThis.CSS?.highlights?.delete(name)
  }
}

export function revealMatch(range: Range, panel: HTMLElement | null): void {
  const element = range.startContainer.parentElement
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
