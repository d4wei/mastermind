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
  /** No other discussion in `source` shares the identity. */
  unique: boolean
}

/** An unsent reply; `thread` becomes null once its discussion no longer exists. */
export interface ReplyDraft { id: number; thread: ThreadRef | null; text: string }

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

type Located = Pick<ThreadCard, 'identity' | 'start'>

/** `cards` are every discussion in `source`. */
export function threadRef(card: Located, source: string, cards: readonly Located[]): ThreadRef {
  const unique = cards.filter((other) => other.identity === card.identity).length === 1
  return { identity: card.identity, start: card.start, source, unique }
}

/** The reference re-anchored to `source`: the same object when unchanged, null once its discussion is gone. */
export function refreshThread(ref: ThreadRef, source: string, cards: readonly Located[]): ThreadRef | null {
  const card = locateThread(ref, source, cards)
  if (!card) return null
  const next = threadRef(card, source, cards)
  return ref.source === source && ref.start === next.start && ref.unique === next.unique ? ref : next
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

/**
 * The single replacement spanning everything that differs between two texts. Repeated text at
 * the boundary admits several such regions; `prefixFirst` picks the one extending the common
 * prefix, otherwise the common suffix.
 */
function changedRegion(before: string, after: string, prefixFirst: boolean): TextEdit {
  const limit = Math.min(before.length, after.length)
  const common = (bound: number, at: (n: number) => boolean) => {
    let n = 0
    while (n < bound && at(n)) n++
    return n
  }
  const fromStart = (bound: number) => common(bound, (n) => before[n] === after[n])
  const fromEnd = (bound: number) => common(bound, (n) => before[before.length - 1 - n] === after[after.length - 1 - n])
  const prefix = prefixFirst ? fromStart(limit) : fromStart(limit - fromEnd(limit))
  const suffix = fromEnd(limit - prefix)
  return { from: prefix, to: before.length - suffix, insert: after.slice(prefix, after.length - suffix) }
}

/** Where `offset` lands after an unknown change; null when it was replaced or the alignments disagree. */
function alignedOffset(offset: number, before: string, after: string): number | null {
  const early = mapOffset(offset, [changedRegion(before, after, true)])
  return early === mapOffset(offset, [changedRegion(before, after, false)]) ? early : null
}

/** Carries each draft's reference through edits applied to `source`. */
export function rebaseReplies(drafts: readonly ReplyDraft[], source: string, edits: readonly TextEdit[]): ReplyDraft[] {
  return drafts.map((draft) => draft.thread ? { ...draft, thread: rebaseThread(draft.thread, source, edits) } : draft)
}

/** Carries a reference through edits applied to its own source; null when they remove its start. */
export function rebaseThread(ref: ThreadRef, source: string, edits: readonly TextEdit[]): ThreadRef | null {
  if (ref.source !== source) return ref
  const start = mapOffset(ref.start, edits)
  return start === null ? null : { ...ref, start, source: applyTextEdits(source, edits) }
}

/**
 * Finds the card a reference names in the current source, or null when it no longer exists. A
 * change of unknown shape is reduced to one changed region, aligned from both ends. A card
 * starting at the agreed offset settles the match. Otherwise only an identity that was unique
 * before the change and still is can name a card, since duplicates are told apart only by offset.
 */
export function locateThread<T extends Located>(ref: ThreadRef, source: string, cards: readonly T[]): T | null {
  const current = ref.source === source
  const start = current ? ref.start : alignedOffset(ref.start, ref.source, source)
  const at = start === null ? undefined : cards.find((card) => card.start === start)
  if (at || current) return at?.identity === ref.identity ? at : null
  const same = cards.filter((card) => card.identity === ref.identity)
  return ref.unique && same.length === 1 ? same[0]! : null
}
