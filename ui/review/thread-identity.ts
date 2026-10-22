import { applyTextEdits } from '../../document/edits'
import type { CriticSpan, ReviewItem } from '../../document/critic/types'
import type { TextEdit } from '../../document/types'

type ThreadItem = Extract<ReviewItem, { type: 'thread' }>

/** A discussion as the comment rail presents it. */
export interface ThreadCard {
  /** Anchor text and opening message; appending replies keeps it. */
  identity: string
  /** Render key: the identity plus its ordinal among identical discussions. */
  key: string
  start: number
  /** Index of the anchor, or of the opening message when there is no anchor. */
  spanIndex: number
  /** Indexes of the anchor and every message. */
  members: number[]
  anchorText: string
  thread: ThreadItem
}

/** A discussion located by its identity and its start offset in `source`. */
export interface ThreadRef {
  identity: string
  start: number
  source: string
}

export function threadCards(items: readonly ReviewItem[], spans: readonly CriticSpan[], source: string): ThreadCard[] {
  const seen = new Map<string, number>()
  return items.filter((item): item is ThreadItem => item.type === 'thread').map((thread) => {
    const anchorText = thread.anchor ? source.slice(thread.anchor.innerStart, thread.anchor.innerEnd) : ''
    const first = thread.comments[0]
    const identity = JSON.stringify([anchorText, first?.author ?? '', first?.body])
    const ordinal = seen.get(identity) ?? 0
    seen.set(identity, ordinal + 1)
    const members = [...(thread.anchor ? [thread.anchor] : []), ...thread.comments.map((comment) => comment.span)]
      .map((span) => spans.indexOf(span))
    return { identity, key: `${identity}#${ordinal}`, start: thread.start, spanIndex: members[0]!, members, anchorText, thread }
  })
}

export function threadRef(card: ThreadCard, source: string): ThreadRef {
  return { identity: card.identity, start: card.start, source }
}

/** The offset after `edits`, or null when an edit replaces the character at `offset`. */
function mapOffset(offset: number, edits: readonly TextEdit[]): number | null {
  let shift = 0
  for (const edit of edits) {
    if (edit.from <= offset && offset < edit.to) return null
    if (edit.to <= offset) shift += edit.insert.length - (edit.to - edit.from)
  }
  return offset + shift
}

/** The single replacement spanning everything that differs between two texts. */
function changedRegion(before: string, after: string): TextEdit {
  const limit = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < limit && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return { from: prefix, to: before.length - suffix, insert: after.slice(prefix, after.length - suffix) }
}

/** Carries a reference through edits applied to its own source; null when they remove its start. */
export function rebaseThread(ref: ThreadRef, source: string, edits: readonly TextEdit[]): ThreadRef | null {
  if (ref.source !== source) return ref
  const start = mapOffset(ref.start, edits)
  return start === null ? null : { ...ref, start, source: applyTextEdits(source, edits) }
}

/**
 * Finds the card a reference names in the current source, or null when it no longer exists. A
 * change of unknown shape is reduced to one changed region. A card starting at the mapped offset
 * settles the match; otherwise only a card whose identity no other card shares is accepted.
 */
export function locateThread<T extends Pick<ThreadCard, 'identity' | 'start'>>(
  ref: ThreadRef, source: string, cards: readonly T[],
): T | null {
  const current = ref.source === source
  const start = current ? ref.start : mapOffset(ref.start, [changedRegion(ref.source, source)])
  const at = start === null ? undefined : cards.find((card) => card.start === start)
  if (at || current) return at?.identity === ref.identity ? at : null
  const same = cards.filter((card) => card.identity === ref.identity)
  return same.length === 1 ? same[0]! : null
}
