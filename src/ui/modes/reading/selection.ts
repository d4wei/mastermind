import type { Node as MarkdownNode, Parent } from 'unist'
import { parseMarkdown } from '../../../shared/markdown/processor'
import type { CriticSpan, Range as SourceRange } from '../../../shared/critic/types'
import { codeRanges, excludedRanges } from '../../../shared/markdown/exclusions'
import type { TextEdit } from '../../../shared/types'

export interface SelRange {
  from: number
  to: number
  text: string
}

export type SelError = 'empty' | 'cross-block' | 'unmapped' | 'overlaps-mark'
export type SelResult = SelRange | { error: SelError }
export type MultiSelResult = { ranges: SelRange[] } | { error: SelError }

const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre,.md-frontmatter'

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
    const visitMarkdown = (node: MarkdownNode): void => {
      const from = node.position?.start.offset
      const to = node.position?.end.offset
      if (from !== undefined && to !== undefined) nodes.set(`${node.type}:${from}:${to}`, node)
      const children = (node as Parent).children
      if (children) children.forEach(visitMarkdown)
    }
    visitMarkdown(tree)
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

function mapWithinBlock(
  range: Range, block: HTMLElement, source: string, opaque: readonly SourceRange[],
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
    const bps = Number(block.dataset.ps)
    const bpe = Number(block.dataset.pe)
    if (!Number.isFinite(bps) || !Number.isFinite(bpe)) return { error: 'unmapped' }
    const blockSource = source.slice(bps, bpe)
    const first = blockSource.indexOf(selectedText)
    if (first === -1 || blockSource.indexOf(selectedText, first + 1) !== -1) return { error: 'unmapped' }
    from = bps + first
    to = from + selectedText.length
  }

  if (splitsOpaqueSyntax(from!, to!, opaque)) return { error: 'unmapped' }
  return { from: from!, to: to!, text: selectedText }
}

function overlapsMark(r: SelRange, spans: readonly CriticSpan[]): boolean {
  return spans.some((s) => r.from < s.end && r.to > s.start)
}

export function rangeToSource(range: Range, source: string, spans: readonly CriticSpan[]): SelResult {
  if (range.collapsed) return { error: 'empty' }
  if (range.toString().length === 0) return { error: 'empty' }

  const startBlock = closestBlock(range.startContainer)
  const endBlock = closestBlock(range.endContainer)
  if (!startBlock || startBlock !== endBlock) return { error: 'cross-block' }

  const tree = parseMarkdown(source)
  const r = mapWithinBlock(range, startBlock, source, excludedRanges(tree), lazyPositionedNodes(tree))
  if ('error' in r) return r
  if (overlapsMark(r, spans)) return { error: 'overlaps-mark' }
  return r
}

/** Ancestor containers must not duplicate the selected ranges of their nested blocks. */
function blocksBetween(range: Range, startBlock: HTMLElement, endBlock: HTMLElement): HTMLElement[] {
  const ca = range.commonAncestorContainer
  const root = (ca.nodeType === Node.ELEMENT_NODE ? ca : ca.parentElement) as HTMLElement | null
  if (!root) return []
  const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    .filter((block) => !block.parentElement?.closest('.md-frontmatter'))
  const si = all.indexOf(startBlock)
  const ei = all.indexOf(endBlock)
  if (si === -1 || ei === -1) return []
  const slice = all.slice(Math.min(si, ei), Math.max(si, ei) + 1)
  return slice.filter((b) => !slice.some((o) => o !== b && b.contains(o)))
}

/**
 * Split a block's selected slice [from, to) into the runs that are free of any
 * existing mark — a new mark can't overlap one already there, so a slice that
 * straddles a highlight/comment becomes the gaps on either side. Whitespace-only
 * gaps are dropped so we never emit an empty `{== ==}`.
 */
function markFreeGaps(
  from: number, to: number, source: string, spans: readonly CriticSpan[], opaque: readonly SourceRange[],
): SelRange[] {
  const blocking = spans
    .filter((s) => s.start < to && s.end > from)
    .sort((a, b) => a.start - b.start)
  const out: SelRange[] = []
  const push = (a: number, b: number): void => {
    const text = source.slice(a, b)
    if (b > a && text.trim().length > 0 && !splitsOpaqueSyntax(a, b, opaque)) {
      out.push({ from: a, to: b, text })
    }
  }
  let cursor = from
  for (const m of blocking) {
    if (m.start > cursor) push(cursor, Math.min(m.start, to))
    cursor = Math.max(cursor, m.end)
    if (cursor >= to) break
  }
  if (cursor < to) push(cursor, to)
  return out
}

const NESTED_CONTAINER = `${BLOCK_SELECTOR},ul,ol`

/** Block actions retain inline syntax while excluding nested block content. */
export function blockContentRanges(
  block: HTMLElement,
  source: string,
  spans: readonly CriticSpan[],
): SelRange[] {
  if (block.tagName === 'PRE' || block.closest('.md-frontmatter')) return []
  let from = Infinity
  let to = -Infinity
  for (const el of block.querySelectorAll<HTMLElement>('[data-ps]')) {
    if (el.closest(NESTED_CONTAINER) !== block) continue
    const ps = Number(el.dataset.ps)
    const pe = Number(el.dataset.pe)
    if (Number.isFinite(ps)) from = Math.min(from, ps)
    if (Number.isFinite(pe)) to = Math.max(to, pe)
  }
  if (from === Infinity || to <= from) return []
  return markFreeGaps(from, to, source, spans, codeRanges(source))
}

/** Unmappable blocks are skipped; markable blocks in the same selection remain available. */
export function rangeToSourceRanges(range: Range, source: string, spans: readonly CriticSpan[]): MultiSelResult {
  if (range.collapsed) return { error: 'empty' }
  if (range.toString().length === 0) return { error: 'empty' }

  const startBlock = closestBlock(range.startContainer)
  const endBlock = closestBlock(range.endContainer)
  if (!startBlock || !endBlock) return { error: 'unmapped' }

  const blocks = startBlock === endBlock ? [startBlock] : blocksBetween(range, startBlock, endBlock)
  if (blocks.length === 0) return { error: 'unmapped' }

  const ranges: SelRange[] = []
  const tree = parseMarkdown(source)
  const opaque = excludedRanges(tree)
  const positionedNodes = lazyPositionedNodes(tree)
  for (const block of blocks) {
    // The single-block case uses the selection as-is; spanning blocks each get a
    // fresh range clamped to the selection where it enters/leaves, block edges
    // otherwise.
    let sub = range
    if (blocks.length > 1) {
      sub = (block.ownerDocument ?? document).createRange()
      sub.selectNodeContents(block)
      if (block === startBlock) sub.setStart(range.startContainer, range.startOffset)
      if (block === endBlock) sub.setEnd(range.endContainer, range.endOffset)
    }
    if (sub.collapsed || sub.toString().trim().length === 0) continue
    const r = mapWithinBlock(sub, block, source, opaque, positionedNodes)
    if ('error' in r) continue
    ranges.push(...markFreeGaps(r.from, r.to, source, spans, opaque))
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
