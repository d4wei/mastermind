import { describe, expect, it } from 'vitest'
import { segmentBlocks } from '../document/blocks'
import { group, scan } from '../document/critic/scanner'
import { applyTextEdits } from '../document/edits'
import { scanMarkdown } from '../document/markdown/scan'
import { deleteCommentEdits, parseResolvedThreads, resolveThreadEdits, type ReviewThread } from '../document/review-archive'

function threads(source: string): ReviewThread[] {
  return group(scanMarkdown(source), source).filter((item): item is ReviewThread => item.type === 'thread')
}
function resolve(source: string): string {
  return applyTextEdits(source, resolveThreadEdits(source, threads(source)[0]!))
}
const tokenPattern = /\{(?:\+\+|--|~~|==|>>)|(?:\+\+|--|~~|==|<<)\}/g

describe('resolved discussion archive', () => {
  it('archives anchored consecutive replies with Unicode and spaced authors', () => {
    const source = 'Start {==quoted words==}{>>@张 三: 说明<<}{>>@Alice Smith: reply<<} end.\n'
    const result = resolve(source)
    expect(result.startsWith('Start quoted words end.\n')).toBe(true)
    const parsed = parseResolvedThreads(result)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]).toMatchObject({ context: 'quoted words',
      thread: '{==quoted words==}{>>@张 三: 说明<<}{>>@Alice Smith: reply<<}', authors: ['张 三', 'Alice Smith'] })
    expect(result.slice(parsed.entries[0]!.range.start, parsed.entries[0]!.range.end)).toMatch(/^<!-- mastermind:resolved-thread v1/)
    expect(scanMarkdown(result)).toEqual([])
    expect(result.endsWith('\n')).toBe(true)
  })

  it('retains surrounding paragraph context for a point comment', () => {
    const result = resolve('Previous paragraph.\n\nContext before {>>@ke: note<<} and after.\n\nNext paragraph.')
    expect(parseResolvedThreads(result).entries[0]!.context).toBe('Context before  and after.')
  })

  it('archives only the containing list item paragraph for a point comment', () => {
    const result = resolve('- a\n- b {>>c<<}\n- d\n')
    expect(result.startsWith('- a\n- b \n- d\n')).toBe(true)
    expect(parseResolvedThreads(result).entries[0]!.context).toBe('b ')
  })

  it('keeps attached suggestion syntax unchanged', () => {
    const source = 'A {++new++}{>>discussion<<} and {--old--} and {~~x~>y~~}.'
    const result = resolve(source)
    expect(result.startsWith('A {++new++} and {--old--} and {~~x~>y~~}.')).toBe(true)
    expect(group(scanMarkdown(result), result).map((item) => item.type)).toEqual(['suggestion', 'suggestion', 'suggestion'])
  })

  it('escapes every mark type and HTML comment delimiter reversibly in string values', () => {
    const source = '{++insert++} {--delete--} {~~old~>new~~} {==highlight==} {>>@Alice Smith: literal <!-- and -->, braces {}, quotes " and \\ Unicode 你好<<}'
    const thread = threads(source)[0]!
    const result = applyTextEdits(source, resolveThreadEdits(source, thread))
    const parsed = parseResolvedThreads(result)
    const entry = parsed.entries[0]!
    expect(entry.thread).toBe(source.slice(thread.start, thread.end))
    expect(entry.context).toContain('{++insert++}')
    expect(entry.context).toContain('{--delete--}')
    expect(entry.context).toContain('{~~old~>new~~}')
    expect(entry.context).toContain('{==highlight==}')
    const raw = result.slice(entry.range.start, entry.range.end)
    expect(raw.match(tokenPattern)).toBeNull()
    expect(raw.match(/<!--/g)).toHaveLength(1)
    expect(raw.match(/-->/g)).toHaveLength(1)
    expect(parsed.diagnostics).toEqual([])
  })

  it.each(['\n', '\r\n'])('preserves original source bytes and no-final-newline with %j', (eol) => {
    const source = `# Header${eol}${eol}Body {>>note<<} tail`
    const result = resolve(source)
    expect(result.startsWith(`# Header${eol}${eol}Body  tail${eol}${eol}`)).toBe(true)
    expect(result.endsWith('-->')).toBe(true)
    if (eol === '\r\n') expect(result.replace(/\r\n/g, '')).not.toContain('\n')
    expect(parseResolvedThreads(result).entries[0]!.thread).toBe('{>>note<<}')
  })

  it('archives multiple threads independently without duplicating stale calls', () => {
    const source = 'First {>>one<<}, second {>>two<<}.'
    const originalThread = threads(source)[0]!
    const first = resolve(source)
    expect(resolveThreadEdits(first, originalThread)).toEqual([])
    const second = resolve(first)
    expect(parseResolvedThreads(second).entries.map((entry) => entry.thread)).toEqual(['{>>one<<}', '{>>two<<}'])
    expect(threads(second)).toEqual([])
  })

  it('rejects stale offsets or edited discussion text without touching the source', () => {
    const source = '{==anchor==}{>>note<<}'
    const captured = threads(source)[0]!
    expect(resolveThreadEdits(`prefix ${source}`, captured)).toEqual([])
    expect(resolveThreadEdits(source.replace('note', 'edit'), captured)).toEqual([])
    expect(deleteCommentEdits(source.replace('note', 'edit'), captured, 0)).toEqual([])
  })

  it('deletes just one comment and unwraps a highlight only after its last reply', () => {
    const source = '{++suggestion++} {==anchor==}{>>@A: first<<}{>>@B: last<<}'
    const deleted = applyTextEdits(source, deleteCommentEdits(source, threads(source)[0]!, 0))
    expect(deleted).toBe('{++suggestion++} {==anchor==}{>>@B: last<<}')
    const last = applyTextEdits(deleted, deleteCommentEdits(deleted, threads(deleted)[0]!, 0))
    expect(last).toBe('{++suggestion++} anchor')
    expect(parseResolvedThreads(last).entries).toEqual([])
  })

  it('ignores invalid comment indexes', () => {
    const source = '{>>note<<}'
    for (const index of [-1, 1, 0.5]) expect(deleteCommentEdits(source, threads(source)[0]!, index)).toEqual([])
  })

  it.each([
    '<!-- mastermind:resolved-thread v2\n{"future":true}\n-->',
    '<!-- mastermind:resolved-thread v1\nnot JSON\n-->',
    '<!-- mastermind:resolved-thread v1\n{"context":"x","thread":9,"authors":[]}\n-->',
  ])('preserves unsupported or malformed records verbatim while diagnosing them', (archive) => {
    const source = `{>>active<<}\r\n\r\n${archive}`
    const parsed = parseResolvedThreads(source)
    expect(parsed.entries).toEqual([])
    expect(parsed.diagnostics).toHaveLength(1)
    const range = parsed.diagnostics[0]!.range
    expect(source.slice(range.start, range.end)).toBe(archive)
    expect(resolve(source)).toContain(archive)
  })

  it('refuses to append into an unterminated archive', () => {
    const source = '{>>active<<}\n\n<!-- mastermind:resolved-thread v1\n{"broken":'
    expect(parseResolvedThreads(source).diagnostics).toHaveLength(1)
    expect(() => resolveThreadEdits(source, threads(source)[0]!)).toThrow('unterminated archive')
  })

  it.each(['```js\nunclosed', '<!-- unclosed', '<script>\nunclosed', '<![CDATA[unclosed', '<?processing unclosed'])('refuses an unsafe tail without source edits: %s', (tail) => {
    const source = `{>>active<<}\n\n${tail}`
    const thread = threads(source)[0]!
    expect(() => resolveThreadEdits(source, thread)).toThrow('unterminated code or HTML block')
  })

  it('reads adjacent independently marked records and preserves diagnostic ranges', () => {
    const known = '<!-- mastermind:resolved-thread v1\n{"context":"quote","thread":"text"}\n-->'
    const unknown = '<!-- mastermind:resolved-thread v9\n{}\n-->'
    const source = known + '\n' + unknown + '\n' + known
    const parsed = parseResolvedThreads(source)
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.diagnostics).toHaveLength(1)
    for (const entry of parsed.entries) expect(source.slice(entry.range.start, entry.range.end)).toBe(known)
    const diagnostic = parsed.diagnostics[0]!
    expect(source.slice(diagnostic.range.start, diagnostic.range.end)).toBe(unknown)
  })

  it('ignores archive examples inside fenced code', () => {
    const source = '```html\n<!-- mastermind:resolved-thread v9\n{}\n-->\n```'
    expect(parseResolvedThreads(source)).toEqual({ entries: [], diagnostics: [] })
  })

  it('keeps archived threads out of raw mark discovery and translation', async () => {
    const result = resolve('{==quote==}{>>@A: note<<}')
    expect(scan(result)).toEqual([])
    expect(result.match(tokenPattern)).toBeNull()
    const blocks = await segmentBlocks(result)
    const archive = blocks.find((block) => block.kind === 'html')
    expect(archive?.translatable).toBe(false)
    expect(blocks.filter((block) => block.translatable).map((block) => block.text)).toEqual(['quote'])
  })
})
