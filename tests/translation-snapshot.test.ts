import { describe, expect, it } from 'vitest'
import { group, scan } from '../document/critic/scanner'
import { applyTextEdits } from '../document/edits'
import { codeRanges } from '../document/markdown/exclusions'
import { resolveThreadEdits } from '../document/review-archive'
import { matchPreparedTranslation, parseTranslatedComment, prepareTranslation, translatedCommentEdit, type PreparedTranslation } from '../document/translation'

async function artifact(source: string): Promise<PreparedTranslation> {
  const projection = await prepareTranslation(source)
  return { version: 1, sourceHash: projection.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: projection.blocks.filter((block) => block.translatable).map(({ id, text }) => ({ id, text })) }
}

describe('whole document translation projection', () => {
  it('assigns distinct ordinal identities to repeated blocks and list items', async () => {
    const projection = await prepareTranslation('Repeated.\n\nRepeated.\n\n- first\n- second')
    expect(projection.blocks.map(({ id, kind, text }) => [id, kind, text])).toEqual([
      ['b1', 'paragraph', 'Repeated.'], ['b2', 'paragraph', 'Repeated.'],
      ['b3', 'listItem', '- first'], ['b4', 'listItem', '- second'],
    ])
  })

  it('ignores comments/highlight wrappers and maps to current original source boundaries', async () => {
    const plain = 'First sentence.\n\nLast sentence.'
    const annotated = 'First {==sentence==}{>>@A: note<<}.\n\nLast sentence.{>>point<<}'
    const projection = await prepareTranslation(annotated)
    expect(projection.sourceHash).toBe((await prepareTranslation(plain)).sourceHash)
    expect(projection.blocks.map((block) => block.text)).toEqual(['First sentence.', 'Last sentence.'])
    expect(annotated.slice(projection.blocks[0]!.start, projection.blocks[0]!.end)).toBe('First {==sentence==}{>>@A: note<<}.')
    expect(annotated.slice(projection.blocks[1]!.start, projection.blocks[1]!.end)).toBe('Last sentence.{>>point<<}')
  })

  it('keeps full-document snapshots valid across resolution and archive-only edits', async () => {
    const source = 'Text {==quote==}{>>@A: note<<}.\n'
    const thread = group(scan(source, codeRanges(source)), source).find((item) => item.type === 'thread')!
    if (thread.type !== 'thread') throw new Error('missing thread')
    const resolved = applyTextEdits(source, resolveThreadEdits(source, thread))
    const original = await artifact(source)
    expect((await prepareTranslation(resolved)).sourceHash).toBe(original.sourceHash)
    const changedArchive = resolved.replace('note', 'historical note')
    expect(await matchPreparedTranslation(changedArchive, original)).not.toBeNull()
    expect((await prepareTranslation(resolved)).blocks.some((block) => block.text.includes('resolved-thread'))).toBe(false)
  })

  it('fingerprints literal code/frontmatter/HTML context without requiring translation for it', async () => {
    const source = '---\ntitle: Original\n---\n\n# Heading\n\n```js\nconst value = 1\n```\n\n<!-- ordinary context -->'
    const projection = await prepareTranslation(source)
    expect(projection.blocks.map(({ kind, translatable }) => [kind, translatable])).toEqual([
      ['yaml', false], ['heading', true], ['code', false], ['html', false],
    ])
    expect((await prepareTranslation(source.replace('value = 1', 'value = 2'))).sourceHash).not.toBe(projection.sourceHash)
    expect((await prepareTranslation(source.replace('Original', 'Changed'))).sourceHash).not.toBe(projection.sourceHash)
    expect((await artifact(source)).blocks).toHaveLength(1)
  })

  it.each(['new prose', '{++new prose++}', '{--old prose--}', '{~~old~>new~~}'])('invalidates the snapshot after narrative or suggestion changes: %s', async (content) => {
    const original = await artifact('original prose')
    expect(await matchPreparedTranslation(content, original)).toBeNull()
  })

  it('requires complete unique translated blocks with correct types and hash', async () => {
    const source = 'First.\n\nSecond.'
    const complete = await artifact(source)
    expect(await matchPreparedTranslation(source, complete)).toEqual(complete)
    for (const bad of [null, [], { ...complete, version: 2 }, { ...complete, sourceHash: 'stale' },
      { ...complete, sourceLang: '../en' }, { ...complete, blocks: complete.blocks.slice(1) },
      { ...complete, blocks: [complete.blocks[0], complete.blocks[0]] },
      { ...complete, blocks: [{ id: 'unknown', text: 'translated' }, complete.blocks[1]] },
      { ...complete, blocks: [{ id: 'b1', text: 1 }, complete.blocks[1]] },
      { ...complete, blocks: [{ id: 'b1', text: '' }, complete.blocks[1]] },
    ]) expect(await matchPreparedTranslation(source, bad)).toBeNull()
  })

  it('checks suggestion order and rejects malformed or newly introduced Critic tokens', async () => {
    const source = 'Text {++insert++} and {~~old~>new~~}.'
    const complete = await artifact(source)
    const translated = (text: string) => ({ ...complete, blocks: [{ id: 'b1', text }] })
    expect(await matchPreparedTranslation(source, translated('文字 {++添加++} 和 {~~旧~>新~~}。'))).not.toBeNull()
    for (const text of ['文字', '{~~旧~>新~~} {++添加++}', '{++未闭合', '{++添加++} {~~旧~>新~~} <<}',
      '{++outer {--nested--}++} {~~旧~>新~~}', '{++添加++} {~~旧~>新~~} {>>comment<<}',
    ]) expect(await matchPreparedTranslation(source, translated(text))).toBeNull()
  })

  it('shares a fingerprint between raw CRLF disk source and LF browser source with current offsets', async () => {
    const raw = '# Heading\r\n\r\nSoft line one\r\nline two{>>note<<}\r\n\r\n- Item\r\n'
    const normalized = raw.replace(/\r\n/g, '\n')
    const disk = await prepareTranslation(raw)
    const browser = await prepareTranslation(normalized)
    expect(disk.sourceHash).toBe(browser.sourceHash)
    expect(disk.blocks.map(({ id, kind, text }) => ({ id, kind, text }))).toEqual(browser.blocks.map(({ id, kind, text }) => ({ id, kind, text })))
    expect(raw.slice(disk.blocks[1]!.start, disk.blocks[1]!.end)).toBe('Soft line one\r\nline two{>>note<<}')
    expect(normalized.slice(browser.blocks[1]!.start, browser.blocks[1]!.end)).toBe('Soft line one\nline two{>>note<<}')
    expect(await matchPreparedTranslation(normalized, await artifact(raw))).not.toBeNull()
    const edit = await translatedCommentEdit(raw, { blockId: 'b3', sourceHash: browser.sourceHash,
      quote: '项目', language: 'zh', author: 'A', body: 'note' })
    expect(edit?.from).toBe(raw.indexOf('- Item') + '- Item'.length)
    const updated = applyTextEdits(raw, [edit!])
    expect(updated.endsWith('<<}\r\n')).toBe(true)
  })

  it('rejects hidden or incompatible translated block structure while permitting ordinary formatting', async () => {
    const source = 'Source paragraph.'
    const complete = await artifact(source)
    const translated = (text: string) => ({ ...complete, blocks: [{ id: 'b1', text }] })
    for (const text of ['<!-- hidden translation -->', '```text\ntranslation\n```', '# Translation', '- Translation', 'One.\n\nTwo.']) {
      expect(await matchPreparedTranslation(source, translated(text))).toBeNull()
    }
    for (const text of ['译文 **强调** 和 *重点*。', 'Soft line\nbreak.', 'Text with `literal` and [link](https://example.com).']) {
      expect(await matchPreparedTranslation(source, translated(text))).not.toBeNull()
    }
  })

  it('maintains original CRLF offsets with annotations', async () => {
    const source = '# Heading\r\n\r\n{==Body==}{>>note<<}.\r\n\r\n- Item\r\n'
    const projection = await prepareTranslation(source)
    for (const block of projection.blocks) {
      expect(source.slice(block.start, block.end)).not.toBe('')
    }
    expect(source.slice(projection.blocks[1]!.start, projection.blocks[1]!.end)).toBe('{==Body==}{>>note<<}.')
    expect(source.slice(projection.blocks[2]!.start, projection.blocks[2]!.end)).toBe('- Item')
  })
})

describe('translated selection point comments', () => {
  it('captures exact multiline quotes, language, author, and authored body safely', async () => {
    const source = 'Original source prose.\r\n'
    const projection = await prepareTranslation(source)
    const quote = '译文\r\n\r\n{++insert++} {--delete--} {~~old~>new~~} {==highlight==} {>>comment<<} <!-- --> " \\ ` ``` 你好'
    const body = 'Authored note\n\nwith <<} reserved delimiters.'
    const edit = await translatedCommentEdit(source, { blockId: 'b1', sourceHash: projection.sourceHash,
      quote, language: 'zh-CN', author: 'Alice Smith', body })
    expect(edit).not.toBeNull()
    const updated = applyTextEdits(source, [edit!])
    const items = group(scan(updated, codeRanges(updated)), updated)
    expect(items).toHaveLength(1)
    const thread = items[0]!
    if (thread.type !== 'thread') throw new Error('not a point comment')
    expect(thread.anchor).toBeNull()
    expect(thread.comments[0]!.author).toBe('Alice Smith')
    expect(parseTranslatedComment(thread.comments[0]!.body)).toEqual({ language: 'zh-CN', quote, comment: body })
    expect((await prepareTranslation(updated)).sourceHash).toBe(projection.sourceHash)
    expect(updated.endsWith('\r\n')).toBe(true)
  })

  it('places feedback after complete highlight delimiters and existing comments', async () => {
    const source = '{==Original==}{>>existing<<}'
    const projection = await prepareTranslation(source)
    const edit = await translatedCommentEdit(source, { blockId: 'b1', sourceHash: projection.sourceHash,
      quote: '原文', language: 'zh', author: '张 三', body: '意见' })
    expect(edit?.from).toBe(source.length)
    const updated = applyTextEdits(source, [edit!])
    expect(scan(updated, codeRanges(updated)).map((span) => span.kind)).toEqual(['highlight', 'comment', 'comment'])
  })

  it('accepts annotation-only changes while recomputing the current source boundary', async () => {
    const source = 'First.\n\nLast.'
    const original = await prepareTranslation(source)
    const annotated = '{>>earlier point<<}First.\n\n{==Last.==}{>>later point<<}'
    const edit = await translatedCommentEdit(annotated, { blockId: 'b2', sourceHash: original.sourceHash,
      quote: '最后', language: 'zh', author: 'A', body: 'note' })
    expect(edit?.from).toBe(annotated.length)
    expect((await prepareTranslation(annotated)).sourceHash).toBe(original.sourceHash)
  })

  it('keeps point anchors before an unrelated adjacent resolved archive and between source blocks', async () => {
    const archive = '<!-- mastermind:resolved-thread v1\n{"context":"old context","thread":"old record"}\n-->'
    const source = '{>>leading<<}First.\n\n{>>between<<}\n\nLast.' + archive
    const plain = 'First.\n\nLast.'
    const expected = await prepareTranslation(plain)
    const projection = await prepareTranslation(source)
    expect(projection.sourceHash).toBe(expected.sourceHash)
    expect(source.slice(projection.blocks[0]!.start, projection.blocks[0]!.end)).toBe('{>>leading<<}First.')
    expect(source.slice(projection.blocks[1]!.start, projection.blocks[1]!.end)).toBe('Last.')
    const edit = await translatedCommentEdit(source, { blockId: 'b2', sourceHash: expected.sourceHash,
      quote: '末尾', language: 'zh', author: 'A', body: 'note' })
    expect(edit?.from).toBe(source.indexOf(archive))
    const updated = applyTextEdits(source, [edit!])
    expect(updated.endsWith(archive)).toBe(true)
    expect((await prepareTranslation(updated)).sourceHash).toBe(expected.sourceHash)
  })

  it('rejects stale fingerprints, missing/literal blocks, and unsafe authors/languages', async () => {
    const source = 'Prose.\n\n```js\ncode\n```'
    const projection = await prepareTranslation(source)
    const request = { blockId: 'b1', sourceHash: projection.sourceHash, quote: '文字', language: 'zh', author: 'A', body: 'note' }
    expect(await translatedCommentEdit('changed', request)).toBeNull()
    for (const patch of [{ blockId: 'b2' }, { blockId: 'missing' }, { sourceHash: 'stale' },
      { quote: '' }, { author: '' }, { author: 'bad\nname' }, { author: 'bad:tag' }, { author: '{>>bad<<}' },
      { language: '../zh' },
    ]) expect(await translatedCommentEdit(source, { ...request, ...patch })).toBeNull()
  })

  it('does not let quoted backticks turn the source comment into inline code', async () => {
    const source = 'Prose with an unmatched ` tick.'
    const projection = await prepareTranslation(source)
    const quote = 'translated ` tick'
    const edit = await translatedCommentEdit(source, { blockId: 'b1', sourceHash: projection.sourceHash,
      quote, language: 'zh', author: 'A', body: 'body ` text' })
    expect(edit).not.toBeNull()
    const updated = applyTextEdits(source, [edit!])
    const span = scan(updated, codeRanges(updated))[0]!
    expect(parseTranslatedComment(updated.slice(span.innerStart, span.innerEnd).replace(/^@A: /, ''))).toEqual({ language: 'zh', quote, comment: 'body ` text' })
  })

  it('keeps ordinary comments and malformed encoded records unchanged', () => {
    for (const body of ['ordinary comment', 'translated-selection v9 {}', 'translated-selection v1 broken',
      'translated-selection v1 {"language":"zh","quote":1,"comment":"x"}',
    ]) expect(parseTranslatedComment(body)).toBeNull()
  })
})
