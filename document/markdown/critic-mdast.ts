import type { Parent, PhrasingContent, Root } from 'mdast'
import type { Node } from 'unist'
import type { Sentinels } from '../critic/mask'
// Container prefixes belong to the enclosing Markdown node, not displayed atom content.
import { stripLinePrefixes } from '../critic/scanner'
import type { CriticSpan } from '../critic/types'

/* ---- custom mdast node shapes ------------------------------------------ */

interface CriticWrapData {
  spanIndex: number
}
interface CriticSubData extends CriticWrapData {
  old: string
  new: string
  raw: string
}
interface CriticCommentData extends CriticWrapData {
  content: string
  raw: string
}

export interface CriticWrapNode extends Parent {
  type: 'criticInsert' | 'criticDelete' | 'criticHighlight'
  children: PhrasingContent[]
  data: CriticWrapData
}
export interface CriticSubNode extends Node {
  type: 'criticSub'
  data: CriticSubData
}
export interface CriticCommentNode extends Node {
  type: 'criticComment'
  data: CriticCommentData
}

type CriticMdastNode = CriticWrapNode | CriticSubNode | CriticCommentNode

const WRAP_TYPE = { ins: 'criticInsert', del: 'criticDelete', highlight: 'criticHighlight' } as const
const OPEN_TEXT = { ins: '{++', del: '{--', highlight: '{==' } as const
const CLOSE_TEXT = { ins: '++}', del: '--}', highlight: '==}' } as const

type WrapKind = 'ins' | 'del' | 'highlight'

/* ---- value segmentation -------------------------------------------------- */

type SegShape =
  | { t: 'plain'; value: string }
  | { t: 'open'; kind: WrapKind }
  | { t: 'close'; kind: WrapKind }
  | { t: 'atom' }

/** `at` is the segment's offset within its text node's value. */
type Seg = SegShape & { at: number }

function buildSegmenter(s: Sentinels): { re: RegExp; classify: (m: string) => SegShape } {
  const o = s.open
  const c = s.close
  const [n0, n1] = s.neutral
  const re = new RegExp(
    [
      `${o.ins}{3}`,
      `${o.del}{3}`,
      `${o.highlight}{3}`,
      `${c.ins}{3}`,
      `${c.del}{3}`,
      `${c.highlight}{3}`,
      `${n0}(?:[${n0}\\n\\r]*${n0})?`,
      `${n1}(?:[${n1}\\n\\r]*${n1})?`,
    ].join('|'),
    'g',
  )
  const byChar = new Map<string, SegShape>([
    [o.ins, { t: 'open', kind: 'ins' }],
    [o.del, { t: 'open', kind: 'del' }],
    [o.highlight, { t: 'open', kind: 'highlight' }],
    [c.ins, { t: 'close', kind: 'ins' }],
    [c.del, { t: 'close', kind: 'del' }],
    [c.highlight, { t: 'close', kind: 'highlight' }],
    [n0, { t: 'atom' }],
    [n1, { t: 'atom' }],
  ])
  return { re, classify: (m) => byChar.get(m[0]!)! }
}

function segmentValue(value: string, seg: { re: RegExp; classify: (m: string) => SegShape }): Seg[] | null {
  seg.re.lastIndex = 0
  if (!seg.re.test(value)) return null
  seg.re.lastIndex = 0
  const out: Seg[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = seg.re.exec(value)) !== null) {
    if (m.index > last) out.push({ t: 'plain', value: value.slice(last, m.index), at: last })
    out.push({ ...seg.classify(m[0]), at: m.index })
    last = m.index + m[0].length
  }
  if (last < value.length) out.push({ t: 'plain', value: value.slice(last), at: last })
  return out
}

/* ---- the transform ------------------------------------------------------- */

interface Streams {
  byKind: Record<WrapKind, CriticSpan[]>
  atoms: CriticSpan[]
}

function offsetPosition(start: number, end: number) {
  return {
    start: { line: 0, column: 0, offset: start },
    end: { line: 0, column: 0, offset: end },
  }
}

function synthPosition(span: CriticSpan) {
  return offsetPosition(span.start, span.end)
}

/**
 * Source offset of a masked text node's value index 0, when value indices map
 * one for one onto the source. Masking preserves length, so the node's own
 * offsets are exact; a value shorter than its source extent has decoded
 * entities or escapes or dropped container prefixes.
 */
function valueOrigin(node: Node, value: string): number | undefined {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return undefined
  return end - start === value.length ? start : undefined
}

function textNode(value: string, origin?: number, at = 0): PhrasingContent {
  const node = { type: 'text', value } as PhrasingContent
  if (origin !== undefined) node.position = offsetPosition(origin + at, origin + at + value.length)
  return node
}

function makeAtom(span: CriticSpan, original: string): PhrasingContent {
  if (span.kind === 'sub') {
    const node: CriticSubNode = {
      type: 'criticSub',
      data: {
        spanIndex: -1, // patched by caller
        old: stripLinePrefixes(original.slice(span.oldStart!, span.oldEnd!)),
        new: stripLinePrefixes(original.slice(span.newStart!, span.newEnd!)),
        raw: original.slice(span.start, span.end),
      },
      position: synthPosition(span),
    } as CriticSubNode
    return node as unknown as PhrasingContent
  }
  const node: CriticCommentNode = {
    type: 'criticComment',
    data: {
      spanIndex: -1,
      content: stripLinePrefixes(original.slice(span.innerStart, span.innerEnd)),
      raw: original.slice(span.start, span.end),
    },
    position: synthPosition(span),
  } as CriticCommentNode
  return node as unknown as PhrasingContent
}

/**
 * Rewrites a tree parsed from MASKED text: sentinel runs in text-node values
 * become criticInsert/criticDelete/criticHighlight wrappers around the
 * content between them, and neutralized regions become criticSub /
 * criticComment atoms whose content is read from the ORIGINAL source.
 *
 * Span association is by document order per kind — the Nth open-run of a
 * kind pairs with the Nth span of that kind. Each nested parent is processed
 * where its parent's walk reaches it, so the per-kind cursors advance in
 * document order across depths. Mismatched pairings (delimiters at different
 * tree depths) degrade to literal delimiter text.
 *
 * Wrappers and atoms take their span's offsets. Text pieces split from a
 * masked text node, literal delimiters included, take offsets within that
 * node when `valueOrigin` finds an exact mapping, and stay unpositioned
 * otherwise.
 */
export function criticTransform(
  tree: Root,
  original: string,
  spans: readonly CriticSpan[],
  sentinels: Sentinels,
): void {
  const seg = buildSegmenter(sentinels)
  const streams: Streams = {
    byKind: {
      ins: spans.filter((s) => s.kind === 'ins'),
      del: spans.filter((s) => s.kind === 'del'),
      highlight: spans.filter((s) => s.kind === 'highlight'),
    },
    atoms: spans.filter((s) => s.kind === 'sub' || s.kind === 'comment'),
  }
  const cursors = { ins: 0, del: 0, highlight: 0, atoms: 0 }
  const spanIndexOf = new Map<CriticSpan, number>()
  spans.forEach((s, i) => spanIndexOf.set(s, i))

  const processParent = (parent: Parent): void => {
    const segmented = parent.children.map((ch) =>
      ch.type === 'text' ? segmentValue((ch as { value: string }).value, seg) : null)
    if (!segmented.some((segs) => segs !== null)) {
      for (const child of parent.children) if ('children' in child) processParent(child)
      return
    }

    const out: PhrasingContent[] = []
    let frame: { kind: WrapKind; span: CriticSpan; acc: PhrasingContent[]; literal: PhrasingContent } | null = null

    const emit = (node: PhrasingContent): void => {
      if (frame) frame.acc.push(node)
      else out.push(node)
    }

    const restoreFrame = (): void => {
      if (!frame) return
      const open = frame
      frame = null
      emit(open.literal)
      for (const n of open.acc) emit(n)
    }

    for (const [index, child] of parent.children.entries()) {
      const segs = segmented[index]
      if (!segs) {
        if ('children' in child) processParent(child)
        emit(child as PhrasingContent)
        continue
      }
      const origin = valueOrigin(child, (child as { value: string }).value)
      for (const s of segs) {
        switch (s.t) {
          case 'plain':
            emit(textNode(s.value, origin, s.at))
            break
          case 'open': {
            // Marks never nest, so an open frame's closer lies at another depth.
            restoreFrame()
            const span = streams.byKind[s.kind][cursors[s.kind]]
            const literal = textNode(OPEN_TEXT[s.kind], origin, s.at)
            if (!span) {
              emit(literal)
              break
            }
            cursors[s.kind]++
            frame = { kind: s.kind, span, acc: [], literal }
            break
          }
          case 'close': {
            if (!frame || frame.kind !== s.kind) {
              emit(textNode(CLOSE_TEXT[s.kind], origin, s.at))
              break
            }
            const done = frame
            frame = null
            const wrapper: CriticWrapNode = {
              type: WRAP_TYPE[done.kind],
              children: done.acc,
              data: { spanIndex: spanIndexOf.get(done.span)! },
              position: synthPosition(done.span),
            } as CriticWrapNode
            emit(wrapper as unknown as PhrasingContent)
            break
          }
          case 'atom': {
            const span = streams.atoms[cursors.atoms]
            if (!span) break // desync — drop the masked chars
            cursors.atoms++
            const atom = makeAtom(span, original)
            ;(atom as unknown as CriticMdastNode).data.spanIndex = spanIndexOf.get(span)!
            emit(atom)
            break
          }
        }
      }
    }
    // unclosed opener (closer at a different depth) → literal
    restoreFrame()
    parent.children = out as Parent['children']
  }

  processParent(tree)
}
