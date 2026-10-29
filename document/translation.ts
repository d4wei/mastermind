import type { ListItem, Root, RootContent } from 'mdast'
import { scanMarkdown, scanMarkdownTree } from './markdown/scan'
import { usableAuthorName } from './author'
import { segmentBlocks } from './blocks'
import { applyTextEdits } from './edits'
import { stringifyEscaped } from './escaped-json'
import { excludedRanges } from './markdown/exclusions'
import { parseMarkdown } from './markdown/processor'
import { parseResolvedThreads } from './review-archive'
import type { TextEdit } from './types'

export interface TranslationBlock {
  id: string
  kind: string
  text: string
  translatable: boolean
  start: number
  end: number
}
interface TranslationProjection {
  sourceHash: string
  blocks: TranslationBlock[]
}
export interface PreparedTranslation {
  version: 1
  sourceHash: string
  sourceLang: string
  targetLang: string
  blocks: Array<{ id: string; text: string }>
}

const LANGUAGE = /^[A-Za-z][A-Za-z0-9_-]*$/

function narrativeProjection(source: string): { text: string; starts: number[]; ends: number[] } {
  const archive = parseResolvedThreads(source)
  const removals: Array<TextEdit & { archive?: boolean }> = [...archive.entries, ...archive.diagnostics]
    .map(({ range }) => ({ from: range.start, to: range.end, insert: '', archive: true }))
  for (const span of scanMarkdown(source)) {
    if (span.kind === 'comment') removals.push({ from: span.start, to: span.end, insert: '' })
    else if (span.kind === 'highlight') removals.push(
      { from: span.start, to: span.innerStart, insert: '' },
      { from: span.innerEnd, to: span.end, insert: '' },
    )
  }
  removals.sort((a, b) => a.from - b.from)
  const starts = [0]
  const ends = [0]
  let text = ''
  let index = 0
  let archiveBoundary = -1
  for (const removal of [...removals, { from: source.length, to: source.length, insert: '' }]) {
    for (; index < removal.from; index++) {
      if (source[index] === '\r' && source[index + 1] === '\n' && index + 1 < removal.from) {
        text += '\n'
        index++
      } else text += source[index]
      starts.push(index + 1)
      ends.push(index + 1)
    }
    index = Math.max(index, removal.to)
    if ('archive' in removal && removal.archive) {
      archiveBoundary = text.length
      starts[starts.length - 1] = index
    } else if (archiveBoundary !== text.length) ends[ends.length - 1] = index
  }
  return { text, starts, ends }
}

export async function prepareTranslation(source: string): Promise<TranslationProjection> {
  const projection = narrativeProjection(source)
  const blocks = segmentBlocks(projection.text).map((block, index): TranslationBlock => ({
    id: `b${index + 1}`, kind: block.kind, text: block.text, translatable: block.translatable,
    start: projection.starts[block.start]!, end: projection.ends[block.end]!,
  }))
  const fingerprint = JSON.stringify(blocks.map(({ id, kind, text, translatable }) => ({ id, kind, text, translatable })))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))
  const sourceHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return { sourceHash, blocks }
}

/**
 * A block's suggestion signature: its active mark kinds in order, plus the
 * ordered literal delimiter tokens outside opaque source that pair with no
 * active mark. Null when the block carries comments or highlights.
 */
function suggestionStructure(text: string): string | null {
  const tree = parseMarkdown(text)
  const excluded = excludedRanges(tree)
  const spans = scanMarkdownTree(text, tree)
  if (spans.some((span) => span.kind === 'comment' || span.kind === 'highlight')) return null
  const delimiters = new Set(spans.flatMap((span) => [span.start, span.end - 3]))
  const literals = [...text.matchAll(/\{(?:\+\+|--|~~|==|>>)|(?:\+\+|--|~~|==|<<)\}/g)]
    .filter((token) => !delimiters.has(token.index) &&
      !excluded.some((range) => token.index >= range.start && token.index < range.end))
    .map((token) => token[0])
  return JSON.stringify({ kinds: spans.map(({ kind }) => kind), literals })
}

export async function matchPreparedTranslation(source: string, artifact: unknown): Promise<PreparedTranslation | null> {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null
  const value = artifact as Record<string, unknown>
  if (value.version !== 1 || typeof value.sourceHash !== 'string' ||
    typeof value.sourceLang !== 'string' || !LANGUAGE.test(value.sourceLang) ||
    typeof value.targetLang !== 'string' || !LANGUAGE.test(value.targetLang) ||
    !Array.isArray(value.blocks) || Object.keys(value).some((key) => !['version', 'sourceHash', 'sourceLang', 'targetLang', 'blocks'].includes(key))) return null
  const projection = await prepareTranslation(source)
  const originals = projection.blocks.filter((block) => block.translatable)
  if (value.sourceHash !== projection.sourceHash || value.blocks.length !== originals.length) return null
  const byId = new Map(originals.map((block) => [block.id, block]))
  const seen = new Set<string>()
  const translated: PreparedTranslation['blocks'] = []
  for (const block of value.blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return null
    const item = block as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.text !== 'string' ||
      Object.keys(item).some((key) => !['id', 'text'].includes(key)) || seen.has(item.id)) return null
    const original = byId.get(item.id)
    if (!original || item.text.trim() === '') return null
    const translatedBlocks = segmentBlocks(item.text)
    if (translatedBlocks.length !== 1 || translatedBlocks[0]!.kind !== original.kind ||
      !translatedBlocks[0]!.translatable) return null
    const sourceStructure = suggestionStructure(original.text)
    const translatedStructure = suggestionStructure(item.text)
    if (!sourceStructure || sourceStructure !== translatedStructure) return null
    seen.add(item.id)
    translated.push({ id: item.id, text: item.text })
  }
  return { version: 1, sourceHash: projection.sourceHash, sourceLang: value.sourceLang,
    targetLang: value.targetLang, blocks: translated }
}

interface TranslatedComment {
  language: string
  quote: string
  comment: string
}
const COMMENT_PREFIX = 'translated-selection v1 '

function encodeComment(comment: TranslatedComment): string {
  return stringifyEscaped(comment, /[{}<>`-]/g)
}

export function parseTranslatedComment(body: string): TranslatedComment | null {
  if (!body.startsWith(COMMENT_PREFIX)) return null
  try {
    const value: unknown = JSON.parse(body.slice(COMMENT_PREFIX.length))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const comment = value as Record<string, unknown>
    if (typeof comment.language !== 'string' || !LANGUAGE.test(comment.language) ||
      typeof comment.quote !== 'string' || typeof comment.comment !== 'string' ||
      Object.keys(comment).some((key) => !['language', 'quote', 'comment'].includes(key))) return null
    return { language: comment.language, quote: comment.quote, comment: comment.comment }
  } catch {
    return null
  }
}

interface TranslatedCommentRequest {
  blockId: string
  sourceHash: string
  quote: string
  language: string
  author: string
  body: string
}

export async function translatedCommentEdit(source: string, request: TranslatedCommentRequest): Promise<TextEdit | null> {
  if (!LANGUAGE.test(request.language) || request.quote.length === 0 ||
    usableAuthorName(request.author) !== request.author) return null
  const projection = await prepareTranslation(source)
  if (projection.sourceHash !== request.sourceHash) return null
  const block = projection.blocks.find((block) => block.id === request.blockId && block.translatable)
  if (!block) return null
  const payload = encodeComment({ language: request.language, quote: request.quote, comment: request.body })
  const insert = `{>>@${request.author}: ${COMMENT_PREFIX}${payload}<<}`
  const tree = parseMarkdown(source)
  const at = commentOffset(blockAt(tree, block.start), block.end)
  const edit = { from: at, to: at, insert }
  // A point comment must remain a complete active mark, and its block must keep its kind and depth.
  const updated = applyTextEdits(source, [edit])
  const updatedTree = parseMarkdown(updated)
  if (!scanMarkdownTree(updated, updatedTree).some((span) => span.kind === 'comment' &&
    span.start === at && span.end === at + insert.length)) return null
  if (blockShape(blockAt(tree, block.start)) !== blockShape(blockAt(updatedTree, block.start))) return null
  return edit
}

/** The top-level block or list item of `tree` that starts at `start`, as `segmentBlocks` divides it. */
function blockAt(tree: Root, start: number): RootContent | ListItem | undefined {
  for (const node of tree.children) {
    if (node.type === 'list') {
      const item = node.children.find((child) => child.position?.start.offset === start)
      if (item) return item
    } else if (node.position?.start.offset === start) return node
  }
  return undefined
}

function blockShape(node: RootContent | ListItem | undefined): string {
  return node ? `${node.type}:${node.type === 'heading' ? node.depth : ''}` : ''
}

/**
 * Where a point comment joins its block: a heading's content ends before a setext underline or a
 * closing `#` sequence, which the comment must not follow; every other block takes it at its end.
 */
function commentOffset(node: RootContent | ListItem | undefined, blockEnd: number): number {
  if (node?.type !== 'heading') return blockEnd
  return node.children.at(-1)?.position?.end.offset ?? blockEnd
}
