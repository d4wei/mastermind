import type { Nodes, Parent, Root, Text as MarkdownText } from 'mdast'
import type { CriticSpan, Range as SourceRange } from '../../../document/critic/types'
import type { Analysis } from '../../../document/markdown/analyze'
import { excludedRanges } from '../../../document/markdown/exclusions'
import { sourceEndAt, sourceStartAt, type TextRun } from '../../../document/markdown/provenance'

/** An exact source slice a review mark may wrap. */
export interface SelRange {
  from: number
  to: number
  text: string
}

/** Why a visible part of a selection cannot take part in a review mark. */
export type ExclusionReason =
  /** Inside an existing suggestion or discussion, where marks would nest. */
  | 'existing-mark'
  /** Display labels the Markdown does not contain, such as footnote numbers. */
  | 'generated-text'
  /** Code blocks, raw HTML, and frontmatter, where delimiters would be literal. */
  | 'opaque-block'
  /** Part of inline code, which is reviewed as a whole span. */
  | 'partial-code'
  /** Part of a link whose text is also its address or reference label. */
  | 'partial-link'
  /** A selection across translated blocks, which a translated comment cannot quote. */
  | 'multiple-translated-blocks'
  /** Rendered text with no exact source position. */
  | 'no-provenance'

export interface ExcludedSegment {
  /** The selected rendered text left out. */
  text: string
  reason: ExclusionReason
}

/** What a settled selection covers in the source revision it was mapped against. */
export interface SelectionCoverage {
  status: 'covered'
  /** The exact source the segments index. */
  revision: string
  /** The selected rendered text. */
  quote: string
  /** Markable source slices in source order, each within one text block. */
  segments: SelRange[]
  /** Selected text left out of every segment, in document order. */
  excluded: ExcludedSegment[]
}

export type SelectionMapping =
  /** Nothing is selected in the document: an empty selection, or one outside it. */
  | { status: 'inactive' }
  /** The selected DOM was rendered from another revision; map again once it re-renders. */
  | { status: 'outdated' }
  | SelectionCoverage

type MappingAnalysis = Pick<Analysis, 'plain' | 'tree' | 'provenance' | 'spans'>

/* ---- the reading tree's selectable structure ----------------------------- */

/**
 * Inline syntax that hides delimiters around rendered content. `locked` content cannot hold a
 * delimiter: an autolink's text is its address, and a shortcut or collapsed reference's text is
 * the label that finds its definition.
 */
interface Wrapper {
  start: number
  end: number
  contentStart: number
  contentEnd: number
  locked: boolean
}

interface TextBlock {
  wrappers: Wrapper[]
}

interface Leaf {
  node: MarkdownText
  start: number
  end: number
  runs: readonly TextRun[] | undefined
  block: TextBlock
  inMark: boolean
}

interface Atom {
  start: number
  end: number
  block: TextBlock
  inMark: boolean
}

interface SelectableIndex {
  leaves: Map<number, Leaf>
  atoms: Map<number, Atom>
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'tableCell'])
const WRAPPERS = new Set(['strong', 'emphasis', 'delete', 'link', 'linkReference'])
const ATOMS = new Set(['inlineCode', 'html', 'image', 'imageReference', 'footnoteReference'])
const CRITIC_WRAPPERS = new Set(['criticInsert', 'criticDelete', 'criticHighlight'])

function extent(node: { position?: Nodes['position'] }): { start: number; end: number } | null {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? null : { start, end }
}

function wrapperOf(node: Parent, source: string): Wrapper | null {
  const own = extent(node)
  if (!own) return null
  const first = node.children[0] && extent(node.children[0])
  const last = node.children.at(-1) && extent(node.children.at(-1)!)
  const autolink = node.type === 'link' && source[own.start] !== '['
  const label = node.type === 'linkReference' && (node as { referenceType?: string }).referenceType !== 'full'
  return {
    ...own,
    contentStart: first?.start ?? own.start,
    contentEnd: last?.end ?? own.end,
    locked: autolink || label || !first || !last,
  }
}

const indexes = new WeakMap<Root, SelectableIndex>()

/** Indexes each text block's leaves, atoms, and wrappers once per reading tree. */
function selectableIndex(tree: Root, source: string, provenance: MappingAnalysis['provenance']): SelectableIndex {
  const cached = indexes.get(tree)
  if (cached) return cached
  const index: SelectableIndex = { leaves: new Map(), atoms: new Map() }
  const phrasing = (node: Nodes, block: TextBlock, inMark: boolean): void => {
    const own = extent(node)
    if (node.type === 'text') {
      if (own) index.leaves.set(own.start, { node, ...own, runs: provenance.get(node), block, inMark })
      return
    }
    if (ATOMS.has(node.type)) {
      if (own) index.atoms.set(own.start, { ...own, block, inMark })
      return
    }
    if (WRAPPERS.has(node.type)) {
      const wrapper = wrapperOf(node as Parent, source)
      if (wrapper) block.wrappers.push(wrapper)
    }
    const mark = inMark || CRITIC_WRAPPERS.has(node.type)
    for (const child of (node as Partial<Parent>).children ?? []) phrasing(child, block, mark)
  }
  const blocks = (node: Nodes): void => {
    if (TEXT_BLOCKS.has(node.type)) {
      const block: TextBlock = { wrappers: [] }
      for (const child of (node as Parent).children) phrasing(child, block, false)
      return
    }
    for (const child of (node as Partial<Parent>).children ?? []) blocks(child)
  }
  blocks(tree)
  indexes.set(tree, index)
  return index
}

/* ---- reading the DOM ----------------------------------------------------- */

/** Rendered review marks; their hidden delimiters make rendered and source text diverge. */
const MARK_SELECTOR = '.critic[data-span-index]'
/** Rendered blocks whose source is opaque to review marks. */
const OPAQUE_SELECTOR = 'pre, .md-frontmatter'

interface Piece {
  from: number
  to: number
  /** The selected rendered text the piece maps. */
  rendered: string
  block: TextBlock
}

type Item = { piece: Piece } | ExcludedSegment

/** The selected part of a text node that intersects `range`. */
function selectedText(range: Range, text: Text): [number, number] {
  const from = text === range.startContainer ? range.startOffset : 0
  const to = text === range.endContainer ? range.endOffset : text.length
  return [from, Math.max(from, to)]
}

function textNodes(root: Node): Text[] {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  return nodes
}

function positioned(element: Element): { start: number; end: number } | null {
  const start = Number((element as HTMLElement).dataset.ps)
  const end = Number((element as HTMLElement).dataset.pe)
  return element.hasAttribute('data-ps') && Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null
}

function overlapsSpan(from: number, to: number, spans: readonly CriticSpan[]): boolean {
  return spans.some((span) => from < span.end && to > span.start)
}

/** Thrown when a positioned element disagrees with the analysis it is mapped against. */
class Outdated extends Error {}

/**
 * Walks the selected text and images in document order, turning each into a source piece or an
 * excluded segment. Throws `Outdated` when a positioned element disagrees with the analysis.
 */
function readItems(range: Range, index: SelectableIndex, spans: readonly CriticSpan[]): Item[] {
  const common = range.commonAncestorContainer
  const root = common.nodeType === Node.ELEMENT_NODE ? common as Element : common.parentElement
  if (!root) return []
  const items: Item[] = []
  const handledAtoms = new Set<Element>()
  const exclude = (text: string, reason: ExclusionReason): void => {
    if (!text.trim()) return
    const last = items.at(-1)
    if (last && 'reason' in last && last.reason === reason) last.text += text
    else items.push({ text, reason })
  }
  const atom = (element: Element): void => {
    handledAtoms.add(element)
    const at = positioned(element)
    const entry = at && index.atoms.get(at.start)
    if (!at || !entry || entry.end !== at.end) throw new Outdated()
    const texts = textNodes(element)
    const selected = texts.map((text) => range.intersectsNode(text) ? text.data.slice(...selectedText(range, text)) : '').join('')
    const complete = texts.length === 0 || (range.isPointInRange(texts[0]!, 0) &&
      range.isPointInRange(texts.at(-1)!, texts.at(-1)!.length))
    if (entry.inMark || overlapsSpan(entry.start, entry.end, spans)) {
      // An image shows no text, so its alternative text stands for it.
      if (texts.length) exclude(selected, 'existing-mark')
      else items.push({ text: element.getAttribute('alt') ?? '', reason: 'existing-mark' })
    } else if (complete) items.push({ piece: { from: entry.start, to: entry.end, rendered: selected, block: entry.block } })
    else exclude(selected, (element as HTMLElement).dataset.atom === 'label' ? 'generated-text' : 'partial-code')
  }
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let node: Node | null = root; node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).matches('img[data-atom]')) atom(node as Element)
      continue
    }
    const text = node as Text
    const [from, to] = selectedText(range, text)
    if (from >= to) continue
    const selected = text.data.slice(from, to)
    const parent = text.parentElement!
    const atomElement = parent.closest('[data-atom]')
    if (parent.closest(MARK_SELECTOR)) exclude(selected, 'existing-mark')
    else if (parent.closest(OPAQUE_SELECTOR)) exclude(selected, 'opaque-block')
    else if (parent.closest('[data-generated]')) exclude(selected, 'generated-text')
    else if (atomElement) { if (!handledAtoms.has(atomElement)) atom(atomElement) }
    else if (parent.matches('span[data-ps]')) items.push(leafItem(text, from, to, parent, index, spans))
    else exclude(selected, 'no-provenance')
  }
  return items
}

/**
 * Maps offsets in a leaf's rendered text to its parsed value; null when the two differ beyond line
 * endings, which an HTML parse of the rendered markup normalizes to LF.
 */
function valueOffsets(rendered: string, value: string): ((offset: number) => number) | null {
  if (rendered === value) return (offset) => offset
  if (rendered !== value.replace(/\r\n?/g, '\n')) return null
  const offsets: number[] = []
  let at = 0
  for (let index = 0; index < rendered.length; index++) {
    offsets.push(at)
    at += value.startsWith('\r\n', at) ? 2 : 1
  }
  offsets.push(at)
  return (offset) => offsets[offset]!
}

function leafItem(
  text: Text, from: number, to: number, span: Element, index: SelectableIndex, spans: readonly CriticSpan[],
): Item {
  const at = positioned(span)
  const leaf = at && index.leaves.get(at.start)
  const valueAt = leaf && at && leaf.end === at.end && valueOffsets(span.textContent ?? '', leaf.node.value)
  if (!valueAt) throw new Outdated()
  let prefix = 0
  for (let sibling = span.firstChild; sibling && sibling !== text; sibling = sibling.nextSibling) {
    prefix += sibling.textContent?.length ?? 0
  }
  const selected = text.data.slice(from, to)
  if (leaf.inMark) return { text: selected, reason: 'existing-mark' }
  const start = leaf.runs && sourceStartAt(leaf.runs, valueAt(prefix + from))
  const end = leaf.runs && sourceEndAt(leaf.runs, valueAt(prefix + to))
  if (start == null || end == null || end <= start) return { text: selected, reason: 'no-provenance' }
  // A recognized mark the transform left literal still owns its source; marks must not nest in it.
  if (overlapsSpan(start, end, spans)) return { text: selected, reason: 'existing-mark' }
  return { piece: { from: start, to: end, rendered: selected, block: leaf.block } }
}

/* ---- planning segments ---------------------------------------------------- */

interface Plan {
  segments: { range: SelRange; rendered: string }[]
  excluded: ExcludedSegment[]
}

/**
 * Splits consecutive pieces of one text block into the fewest segments whose delimiters keep every
 * wrapper's syntax intact. A segment may contain whole wrappers, sit inside one wrapper's content,
 * or lie beside it; a wrapper the pieces only partly cover splits them at its content boundary, which
 * the parser identified. Existing marks between pieces split them too. Pieces inside locked content
 * that a segment does not wrap whole are excluded.
 */
function plan(pieces: Piece[], spans: readonly CriticSpan[], source: string, out: Plan): void {
  if (!pieces.length) return
  const wrappers = pieces[0]!.block.wrappers
  let from = pieces[0]!.from
  let to = pieces.at(-1)!.to
  // Pieces that run from one edge of a wrapper's content past its other edge select it completely,
  // so the segment takes the syntax on that edge as well.
  for (let extended = true; extended;) {
    extended = false
    for (const wrapper of wrappers) {
      if (from === wrapper.contentStart && to > wrapper.contentEnd && wrapper.start < from) { from = wrapper.start; extended = true }
      if (to === wrapper.contentEnd && from < wrapper.contentStart && wrapper.end > to) { to = wrapper.end; extended = true }
    }
  }
  const splitAt = (inFirst: (piece: Piece) => boolean): void => {
    const first = pieces.filter(inFirst)
    plan(first, spans, source, out)
    plan(pieces.slice(first.length), spans, source, out)
  }
  const span = spans.find((mark) => from < mark.end && to > mark.start)
  if (span) return splitAt((piece) => piece.to <= span.start)
  for (const wrapper of wrappers) {
    if ((from <= wrapper.start && to >= wrapper.end) || to <= wrapper.start || from >= wrapper.end) continue
    if (from >= wrapper.contentStart && to <= wrapper.contentEnd) {
      if (!wrapper.locked) continue
      out.excluded.push({ text: pieces.map((piece) => piece.rendered).join(''), reason: 'partial-link' })
      return
    }
    return splitAt((piece) => (from < wrapper.start ? piece.to <= wrapper.start : piece.to <= wrapper.contentEnd))
  }
  out.segments.push({ range: { from, to, text: source.slice(from, to) }, rendered: pieces.map((piece) => piece.rendered).join('') })
}

/** A guard for a reading tree that diverges from the plain parse: no delimiter lands in opaque source. */
function splitsOpaqueSyntax(from: number, to: number, opaque: readonly SourceRange[]): boolean {
  return opaque.some((r) => (r.start < from && from < r.end) || (r.start < to && to < r.end))
}

/**
 * Maps a DOM selection in a rendered `analysis` of `source` to the source slices review marks can
 * wrap, accounting for every visible selected segment left out and why. `root`, when given, bounds
 * the document; a selection outside it, or with no visible text, is inactive.
 */
export function mapSelection(range: Range, source: string, analysis: MappingAnalysis, root?: Node | null): SelectionMapping {
  const quote = range.toString()
  if (range.collapsed || !quote.trim()) return { status: 'inactive' }
  if (root && !root.contains(range.commonAncestorContainer)) return { status: 'inactive' }
  const index = selectableIndex(analysis.tree, source, analysis.provenance)
  let items: Item[]
  try {
    items = readItems(range, index, analysis.spans)
  } catch (error) {
    if (error instanceof Outdated) return { status: 'outdated' }
    throw error
  }
  const segments: SelRange[] = []
  const excluded: ExcludedSegment[] = []
  const opaque = excludedRanges(analysis.plain)
  // Pieces join only within one text block and never across excluded text.
  let run: Piece[] = []
  const flush = (): void => {
    const planned: Plan = { segments: [], excluded: [] }
    plan(run, analysis.spans, source, planned)
    run = []
    for (const { range: segment, rendered } of planned.segments) {
      if (!rendered.trim()) continue
      if (splitsOpaqueSyntax(segment.from, segment.to, opaque)) excluded.push({ text: rendered, reason: 'no-provenance' })
      else segments.push(segment)
    }
    excluded.push(...planned.excluded)
  }
  for (const item of items) {
    if ('piece' in item) {
      if (run.length && run[0]!.block !== item.piece.block) flush()
      run.push(item.piece)
    } else {
      flush()
      excluded.push(item)
    }
  }
  flush()
  if (!segments.length && !excluded.length) return { status: 'inactive' }
  segments.sort((a, b) => a.from - b.from)
  return { status: 'covered', revision: source, quote, segments, excluded }
}
