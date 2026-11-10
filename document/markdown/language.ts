import type { Root } from 'mdast'

/** Which scripts that select a CJK face a run of text holds. */
export interface Scripts {
  kana: boolean
  hangul: boolean
  han: boolean
}

/** What one scan of a document found; the [contract](language.md) says how it resolves. */
export interface ScriptProfile extends Scripts {
  /** The frontmatter's `lang`, canonicalized, when it is a well-formed language tag. */
  declared?: string
  /** The blocks that hold kana or hangul, by source start offset; only they can be exceptions. */
  marked: ReadonlyArray<{ start: number; kana: boolean; hangul: boolean }>
  /** How many blocks hold Han and neither kana nor hangul. */
  hanOnly: number
}

export interface DocumentLanguages {
  /** The document's language; absent when nothing names or implies one. */
  document?: string
  /** The language of each block that differs from the document's, by the block's source start. */
  blocks: ReadonlyMap<number, string>
}

/** The canonical form of a well-formed BCP 47 language tag, or undefined for anything else. */
export function wellFormedLanguage(tag: unknown): string | undefined {
  if (typeof tag !== 'string' || !tag) return undefined
  try {
    return Intl.getCanonicalLocales(tag)[0]
  } catch {
    return undefined
  }
}

const FRONTMATTER_LANG = /^lang[ \t]*:[ \t]*(.*)$/m

/** The top-level `lang` key of a YAML frontmatter, read without a YAML parser. */
function frontmatterLanguage(yaml: string): string | undefined {
  const raw = FRONTMATTER_LANG.exec(yaml)?.[1]
  if (raw === undefined) return undefined
  const value = raw.replace(/[ \t]+#.*$/, '').trim()
  const quoted = /^(["'])(.*)\1$/.exec(value)
  return wellFormedLanguage(quoted ? quoted[2] : value)
}

/** UTF-16 ranges per script; Han beyond the BMP is read from its high surrogate (planes 2 and 3). */
function scriptOf(code: number): keyof Scripts | null {
  if (code < 0x1100) return null
  if (code <= 0x11ff) return 'hangul'
  if (code < 0x3040) return null
  // The katakana middle dot (U+30FB) also separates names in Chinese text, so it implies nothing.
  if (code <= 0x30ff) return code === 0x30fb ? null : 'kana'
  if (code >= 0x3130 && code <= 0x318f) return 'hangul'
  if (code >= 0x31f0 && code <= 0x31ff) return 'kana'
  if (code >= 0x3400 && code <= 0x4dbf) return 'han'
  if (code >= 0x4e00 && code <= 0x9fff) return 'han'
  if (code >= 0xa960 && code <= 0xa97f) return 'hangul'
  if (code >= 0xac00 && code <= 0xd7ff) return 'hangul'
  if (code >= 0xd840 && code <= 0xd8bf) return 'han'
  if (code >= 0xf900 && code <= 0xfaff) return 'han'
  if (code >= 0xff66 && code <= 0xff9f) return 'kana'
  if (code >= 0xffa0 && code <= 0xffdc) return 'hangul'
  return null
}

/**
 * Accumulates the scripts of `source[start, end)` into `into`, skipping review comments, which
 * belong to their reviewer's language rather than the document's. A `{>>` without its `<<}` inside
 * the range ends the skipping for the range, so the scan stays linear.
 */
function scanRange(source: string, start: number, end: number, into: Scripts): void {
  let comments = true
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i)
    if (code === 0x7b && comments && source.startsWith('{>>', i)) {
      let close = i + 3
      while (close < end - 2 && !source.startsWith('<<}', close)) close++
      if (close < end - 2) { i = close + 2; continue }
      comments = false
      continue
    }
    const script = scriptOf(code)
    if (script) into[script] = true
  }
}

/**
 * One linear pass over the source, block by block, using the plain parse the caller already holds:
 * top-level blocks and the items of top-level lists, the units translation segments by.
 */
export function scanScripts(source: string, plain: Root): ScriptProfile {
  const whole: Scripts = { kana: false, hangul: false, han: false }
  const block: Scripts = { kana: false, hangul: false, han: false }
  const marked: Array<ScriptProfile['marked'][number]> = []
  let declared: string | undefined
  let hanOnly = 0
  const visit = (node: { position?: { start: { offset?: number }; end: { offset?: number } } }) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return
    block.kana = block.hangul = block.han = false
    scanRange(source, start, end, block)
    whole.kana ||= block.kana
    whole.hangul ||= block.hangul
    whole.han ||= block.han
    if (block.kana || block.hangul) marked.push({ start, kana: block.kana, hangul: block.hangul })
    else if (block.han) hanOnly++
  }
  for (const node of plain.children) {
    if (node.type === 'yaml') declared ??= frontmatterLanguage(node.value)
    if (node.type === 'list') for (const item of node.children) visit(item)
    else visit(node)
  }
  return { ...whole, declared, marked, hanOnly }
}

const primary = (tag: string | undefined) => tag?.split('-')[0]!.toLowerCase()

/**
 * The script most of a document's CJK blocks are written in. Japanese and Korean prose carries
 * kana or hangul in nearly every block, so a quotation or two in a Chinese document stays an
 * exception instead of renaming the document, while a Japanese document keeps its kanji-only
 * headings. Ties go to the script that says more: kana, then hangul, then Han.
 */
function detectedLanguage(profile: ScriptProfile): string | undefined {
  let kana = 0, hangul = 0
  for (const block of profile.marked) block.kana ? kana++ : hangul++
  if (kana > 0 && kana >= hangul && kana >= profile.hanOnly) return 'ja'
  if (hangul > 0 && hangul >= profile.hanOnly) return 'ko'
  return profile.han ? 'zh-CN' : undefined
}

/**
 * The document's language is the first of: the frontmatter's `lang`, `supplied` (a language the
 * agent or a prepared translation names; ignored unless well-formed), and the script most of its
 * CJK blocks are in. A kana block outside a Japanese document is `ja`, and a hangul block without
 * kana outside a Korean one is `ko`; every other block takes the document's language.
 */
export function resolveLanguages(profile: ScriptProfile, supplied?: string): DocumentLanguages {
  const document = profile.declared ?? wellFormedLanguage(supplied) ?? detectedLanguage(profile)
  const own = primary(document)
  const blocks = new Map<number, string>()
  for (const { start, kana, hangul } of profile.marked) {
    if (kana) { if (own !== 'ja') blocks.set(start, 'ja') }
    else if (hangul && own !== 'ko') blocks.set(start, 'ko')
  }
  return { document, blocks }
}

/** No language at all: the view inherits the interface's. */
export const NO_LANGUAGES: DocumentLanguages = { blocks: new Map() }
