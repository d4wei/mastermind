import type { Node as MarkdownNode, Parent } from 'unist'
import { visit } from 'unist-util-visit'
import type { CriticSpan, Range as SourceRange } from '../../../document/critic/types'
import type { Analysis } from '../../../document/markdown/analyze'
import { excludedRanges } from '../../../document/markdown/exclusions'
import type { TextEdit } from '../../../document/types'

export interface SelRange {
  from: number
  to: number
  text: string
}

type SelError = 'empty' | 'unmapped'
type SelResult = SelRange | { error: SelError }
type MultiSelResult = { ranges: SelRange[] } | { error: SelError }

const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre,.md-frontmatter'
/** Rendered review marks; their hidden delimiters make rendered and source text diverge. */
const MARK_SELECTOR = '.critic[data-span-index]'

function closestBlock(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
  return el?.closest('.md-frontmatter') ?? el?.closest(BLOCK_SELECTOR) ?? null
}

function normalizePoint(node: Node, offset: number): { node: Node; offset: number } {
  let current = node
  let off = offset
  while (current.nodeType === Node.ELEMENT_NODE) {
    const el = current as HTMLElement
    if (off < el.childNodes.length) {
      current = el.childNodes[off]!
      off = 0
    } else if (el.childNodes.length > 0) {
      current = el.childNodes[el.childNodes.length - 1]!
      off = current.nodeType === Node.TEXT_NODE ? (current.textContent?.length ?? 0) : current.childNodes.length
    } else {
      break
    }
  }
  return { node: current, offset: off }
}

/** Escapes and entities can make rendered offsets differ from source offsets. */
function pointToOffset(rawNode: Node, rawOffset: number): number | null {
  const { node, offset } = normalizePoint(rawNode, rawOffset)
  if (node.nodeType !== Node.TEXT_NODE) return null
  const el = node.parentElement
  if (!el) return null
  const span = el.closest('[data-ps]') as HTMLElement | null
  if (!span) return null
  const ps = Number(span.dataset.ps)
  const pe = Number(span.dataset.pe)
  if (!Number.isFinite(ps) || !Number.isFinite(pe)) return null
  const value = span.textContent ?? ''
  if (pe - ps !== value.length) return null
  let prefix = 0
  let walker: Node | null = span.firstChild
  while (walker && walker !== node) {
    prefix += walker.textContent?.length ?? 0
    walker = walker.nextSibling
  }
  if (!walker) return null
  return ps + prefix + offset
}

/** Code is atomic for review: put delimiters outside its backticks, never inside them. */
function selectedInlineCode(range: Range, block: HTMLElement, source: string): SelRange | null {
  for (const code of block.querySelectorAll<HTMLElement>('code.md-inline-code')) {
    const content = code.ownerDocument.createRange()
    const start = normalizePoint(code, 0)
    const end = normalizePoint(code, code.childNodes.length)
    content.setStart(start.node, start.offset)
    content.setEnd(end.node, end.offset)
    if (range.toString() !== code.textContent ||
        range.compareBoundaryPoints(Range.START_TO_START, content) > 0 ||
        range.compareBoundaryPoints(Range.END_TO_END, content) < 0) continue
    const from = Number(code.dataset.ps)
    const to = Number(code.dataset.pe)
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
      return { from, to, text: source.slice(from, to) }
    }
  }
  return null
}

/** A surrounding mark can contain code, but neither delimiter may land inside it. */
function splitsOpaqueSyntax(from: number, to: number, opaque: readonly SourceRange[]): boolean {
  return opaque.some((r) =>
    (r.start < from && from < r.end) || (r.start < to && to < r.end))
}

const INLINE_FORMAT_TYPES: Record<string, string> = {
  STRONG: 'strong', EM: 'emphasis', DEL: 'delete', A: 'link', CODE: 'inlineCode',
}

function comparePoints(first: Range, firstEnd: boolean, second: Range, secondEnd: boolean): number {
  const a = first.cloneRange()
  const b = second.cloneRange()
  a.collapse(!firstEnd)
  b.collapse(!secondEnd)
  return a.compareBoundaryPoints(Range.START_TO_START, b)
}

function inlineText(node: MarkdownNode): string | null {
  if (node.type === 'text' || node.type === 'inlineCode') return (node as MarkdownNode & { value: string }).value
  if (!Object.values(INLINE_FORMAT_TYPES).includes(node.type)) return null
  const values = (node as Parent).children.map(inlineText)
  return values.some((value) => value === null) ? null : values.join('')
}

function lazyPositionedNodes(tree: MarkdownNode): () => Map<string, MarkdownNode> {
  let positioned: Map<string, MarkdownNode> | undefined
  return () => {
    if (positioned) return positioned
    const nodes = new Map<string, MarkdownNode>()
    visit(tree, (node) => {
      const from = node.position?.start.offset
      const to = node.position?.end.offset
      if (from !== undefined && to !== undefined) nodes.set(`${node.type}:${from}:${to}`, node)
    })
    positioned = nodes
    return positioned
  }
}

/** Fully selected positioned wrappers account for syntax absent from the rendered text. */
function mapFormattedSelection(
  range: Range, block: HTMLElement, source: string, positionedNodes: () => Map<string, MarkdownNode>,
): SelResult | null {
  const formats = Array.from(block.querySelectorAll<HTMLElement>('strong[data-ps],em[data-ps],del[data-ps],a[data-ps],code.md-inline-code[data-ps]'))
  if (!formats.some((element) => range.intersectsNode(element))) return null
  const positioned = positionedNodes()
  const pieces: { from: number; to: number; rendered: string }[] = []
  const visitDom = (node: Node): boolean => {
    const content = block.ownerDocument.createRange()
    content.selectNodeContents(node)
    const start = normalizePoint(content.startContainer, content.startOffset)
    const end = normalizePoint(content.endContainer, content.endOffset)
    content.setStart(start.node, start.offset)
    content.setEnd(end.node, end.offset)
    if (comparePoints(range, false, content, true) >= 0 ||
        comparePoints(range, true, content, false) <= 0) return true
    if (node instanceof HTMLElement && formats.includes(node)) {
      const complete = comparePoints(range, false, content, false) <= 0 &&
        comparePoints(range, true, content, true) >= 0
      if (complete) {
        const from = Number(node.dataset.ps)
        const to = Number(node.dataset.pe)
        const markdown = positioned.get(`${INLINE_FORMAT_TYPES[node.tagName]}:${from}:${to}`)
        if (!markdown || inlineText(markdown) !== node.textContent) return false
        pieces.push({ from, to, rendered: node.textContent ?? '' })
        return true
      }
      // Crossing a partial wrapper would strand its opening or closing syntax outside the mark.
      if (node.tagName === 'CODE' || comparePoints(range, false, content, false) < 0 ||
          comparePoints(range, true, content, true) > 0) return false
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const selected = content.cloneRange()
      if (comparePoints(range, false, content, false) > 0) selected.setStart(range.startContainer, range.startOffset)
      if (comparePoints(range, true, content, true) < 0) selected.setEnd(range.endContainer, range.endOffset)
      const from = pointToOffset(selected.startContainer, selected.startOffset)
      const to = pointToOffset(selected.endContainer, selected.endOffset)
      const rendered = selected.toString()
      if (from === null || to === null || source.slice(from, to) !== rendered) return false
      pieces.push({ from, to, rendered })
      return true
    }
    return Array.from(node.childNodes).every(visitDom)
  }
  if (!visitDom(block) || !pieces.length || pieces.map((piece) => piece.rendered).join('') !== range.toString()) {
    return { error: 'unmapped' }
  }
  // Only AST-verified complete wrappers may bridge hidden Markdown syntax; other source gaps refuse.
  if (pieces.some((piece, index) => index > 0 && pieces[index - 1]!.to !== piece.from)) return { error: 'unmapped' }
  const from = pieces[0]!.from
  const to = pieces.at(-1)!.to
  return { from, to, text: source.slice(from, to) }
}

/**
 * Escapes and entities change a leaf's rendered length, so its offsets cannot be read directly.
 * The selected text then maps only when it occurs exactly once in both the rendered and the source
 * text of its window: the narrowest positioned element holding the selection, narrowed to the extent
 * between the nearest positioned elements or review marks on either side. A unique match outside
 * that window may be a different occurrence than the one the reader selected.
 */
function uniqueOccurrence(
  range: Range, block: HTMLElement, source: string, spans: readonly CriticSpan[], text: string,
): number | null {
  const common = range.commonAncestorContainer
  const holder = (common.nodeType === Node.ELEMENT_NODE ? common as Element : common.parentElement)
    ?.closest<HTMLElement>('[data-ps]')
  const scope = holder && block.contains(holder) ? holder : block
  let from = Number(scope.dataset.ps)
  let to = Number(scope.dataset.pe)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  const rendered = scope.ownerDocument.createRange()
  rendered.selectNodeContents(scope)
  for (const neighbor of scope.querySelectorAll<HTMLElement>(`[data-ps], ${MARK_SELECTOR}`)) {
    const span = neighbor.matches(MARK_SELECTOR) ? spans[Number(neighbor.dataset.spanIndex)] : undefined
    const start = span ? span.start : Number(neighbor.dataset.ps)
    const end = span ? span.end : Number(neighbor.dataset.pe)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    const extent = scope.ownerDocument.createRange()
    extent.selectNode(neighbor)
    // Elements holding or crossing the selection bound nothing; nested neighbors never widen a bound.
    if (comparePoints(extent, true, range, false) <= 0) {
      if (end > from) { from = end; rendered.setStartAfter(neighbor) }
    } else if (comparePoints(extent, false, range, true) >= 0) {
      if (start < to) { to = start; rendered.setEndBefore(neighbor) }
    }
  }
  const occursOnce = (haystack: string): number | null => {
    const first = haystack.indexOf(text)
    return first === -1 || haystack.indexOf(text, first + 1) !== -1 ? null : first
  }
  const offset = from <= to ? occursOnce(source.slice(from, to)) : null
  return offset === null || occursOnce(rendered.toString()) === null ? null : from + offset
}

function mapWithinBlock(
  range: Range, block: HTMLElement, source: string, spans: readonly CriticSpan[], opaque: readonly SourceRange[],
  positionedNodes: () => Map<string, MarkdownNode>,
): SelResult {
  const selectedText = range.toString()
  if (selectedText.length === 0) return { error: 'empty' }
  if (block.tagName === 'PRE' || block.matches('.md-frontmatter')) return { error: 'unmapped' }
  const code = selectedInlineCode(range, block, source)
  if (code) return code

  let from = pointToOffset(range.startContainer, range.startOffset)
  let to = pointToOffset(range.endContainer, range.endOffset)

  const valid = from !== null && to !== null && to > from && source.slice(from, to) === selectedText
  if (!valid) {
    const formatted = mapFormattedSelection(range, block, source, positionedNodes)
    if (formatted) {
      if (!('error' in formatted)) {
        if (splitsOpaqueSyntax(formatted.from, formatted.to, opaque)) return { error: 'unmapped' }
        return formatted
      }
      const start = normalizePoint(range.startContainer, range.startOffset)
      const end = normalizePoint(range.endContainer, range.endOffset)
      // A single text leaf can use the existing substring fallback without bridging hidden syntax.
      if (start.node !== end.node || start.node.nodeType !== Node.TEXT_NODE) return formatted
    }
    const fallback = uniqueOccurrence(range, block, source, spans, selectedText)
    if (fallback === null) return { error: 'unmapped' }
    from = fallback
    to = from + selectedText.length
  }

  if (splitsOpaqueSyntax(from!, to!, opaque)) return { error: 'unmapped' }
  return { from: from!, to: to!, text: selectedText }
}

function overlapsMark(r: SelRange, spans: readonly CriticSpan[]): boolean {
  return spans.some((s) => r.from < s.end && r.to > s.start)
}

/** Includes the common ancestor itself, which is the outer item when a selection enters a nested list. */
function blocksBetween(range: Range, startBlock: HTMLElement, endBlock: HTMLElement): HTMLElement[] {
  const ca = range.commonAncestorContainer
  const root = (ca.nodeType === Node.ELEMENT_NODE ? ca : ca.parentElement) as HTMLElement | null
  if (!root) return []
  const all = [
    ...(root.matches(BLOCK_SELECTOR) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR),
  ].filter((block) => !block.parentElement?.closest('.md-frontmatter'))
  const si = all.indexOf(startBlock)
  const ei = all.indexOf(endBlock)
  if (si === -1 || ei === -1) return []
  return all.slice(Math.min(si, ei), Math.max(si, ei) + 1)
}

/**
 * Ends the range in the last text before `element`. A boundary placed between elements would
 * otherwise normalize forward into `element`'s first text and map to an offset past hidden syntax.
 */
function endBefore(range: Range, block: HTMLElement, element: Element): void {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  for (let node = walker.nextNode(); node && element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING;
    node = walker.nextNode()) last = node as Text
  if (last) range.setEnd(last, last.length)
  else range.setEndBefore(element)
}

/** The parts of a block's selected range outside rendered review marks, in document order. */
function outsideMarks(sub: Range, block: HTMLElement): Range[] {
  const pieces: Range[] = []
  const rest = sub.cloneRange()
  for (const mark of block.querySelectorAll(MARK_SELECTOR)) {
    if (!rest.intersectsNode(mark)) continue
    const before = rest.cloneRange()
    endBefore(before, block, mark)
    pieces.push(before)
    rest.setStartAfter(mark)
  }
  pieces.push(rest)
  return pieces
}

/**
 * A block's sub-range excludes rendered review marks and nested blocks; the pieces that remain map
 * independently, and unmappable pieces are skipped while the others stay markable. `analysis`
 * describes `source`.
 */
export function rangeToSourceRanges(range: Range, source: string,
  { plain, spans }: Pick<Analysis, 'plain' | 'spans'>): MultiSelResult {
  if (range.collapsed) return { error: 'empty' }
  if (range.toString().length === 0) return { error: 'empty' }

  const startBlock = closestBlock(range.startContainer)
  const endBlock = closestBlock(range.endContainer)
  if (!startBlock || !endBlock) return { error: 'unmapped' }

  const blocks = startBlock === endBlock ? [startBlock] : blocksBetween(range, startBlock, endBlock)
  if (blocks.length === 0) return { error: 'unmapped' }

  const ranges: SelRange[] = []
  const opaque = excludedRanges(plain)
  const positionedNodes = lazyPositionedNodes(plain)
  for (const block of blocks) {
    const sub = block.ownerDocument.createRange()
    sub.selectNodeContents(block)
    if (block === startBlock) sub.setStart(range.startContainer, range.startOffset)
    if (block === endBlock) sub.setEnd(range.endContainer, range.endOffset)
    // A container block's own text precedes its nested blocks, which map as blocks themselves.
    const nested = block.querySelector(BLOCK_SELECTOR)
    if (nested && sub.intersectsNode(nested)) endBefore(sub, block, nested)
    for (const piece of outsideMarks(sub, block)) {
      if (piece.collapsed || piece.toString().trim().length === 0) continue
      const r = mapWithinBlock(piece, block, source, spans, opaque, positionedNodes)
      // Marks without a rendered element to split at, such as literal marks and unanchored
      // highlights, must not be nested inside or crossed.
      if ('error' in r || overlapsMark(r, spans)) continue
      ranges.push(r)
    }
  }

  if (ranges.length === 0) return { error: 'unmapped' }
  ranges.sort((a, b) => a.from - b.from)
  return { ranges }
}

export function markEdits(
  ranges: readonly SelRange[],
  wrap: (text: string, index: number, isLast: boolean) => string,
): TextEdit[] {
  return ranges.map((r, i) => ({ from: r.from, to: r.to, insert: wrap(r.text, i, i === ranges.length - 1) }))
}
