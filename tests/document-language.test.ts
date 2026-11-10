import { describe, expect, it, vi } from 'vitest'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { parseMarkdown } from '../document/markdown/processor'
import { agentLanguage, resolveLanguages, scanScripts, wellFormedLanguage } from '../document/markdown/language'

const parses = vi.hoisted(() => ({ count: 0 }))
vi.mock('../document/markdown/processor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../document/markdown/processor')>()
  return { ...actual, parseMarkdown: (source: string) => { parses.count++; return actual.parseMarkdown(source) } }
})

function languages(source: string, supplied?: string) {
  return resolveLanguages(scanScripts(source, parseMarkdown(source)), supplied)
}
/** Each block's own language, by the text it starts with. */
function exceptions(source: string, supplied?: string): Record<string, string> {
  const { blocks } = languages(source, supplied)
  return Object.fromEntries([...blocks].map(([start, lang]) => [source.slice(start, start + 4), lang]))
}

describe('document language', () => {
  it('reads a well-formed frontmatter lang before every other tier', () => {
    expect(languages('---\nlang: fr\n---\n\nかな and 한국어 and 漢字.\n', 'de').document).toBe('fr')
    expect(languages('---\ntitle: x\nlang: "zh-tw"\n---\n\n文字\n').document).toBe('zh-TW')
    expect(languages("---\nlang: 'ja' # declared\n---\n\n文字\n").document).toBe('ja')
  })

  it('ignores a malformed or nested frontmatter lang and falls through', () => {
    expect(languages('---\nlang: en_US\n---\n\n文字\n').document).toBe('zh-CN')
    expect(languages('---\nlang:\n---\n\n文字\n').document).toBe('zh-CN')
    expect(languages('---\nlang: not a tag\n---\n\nかな\n').document).toBe('ja')
    expect(languages('---\nmeta:\n  lang: fr\n---\n\nPlain.\n').document).toBeUndefined()
    // A `lang:` line outside the leading frontmatter is prose, not metadata.
    expect(languages('Plain.\n\nlang: fr\n').document).toBeUndefined()
  })

  it('takes a supplied language before detection, when it is well-formed', () => {
    expect(languages('漢字だけではない。\n', 'zh-cn').document).toBe('zh-CN')
    expect(languages('Plain.\n', 'ko').document).toBe('ko')
    expect(languages('かな\n', 'zh_CN').document).toBe('ja')
    expect(languages('かな\n', '').document).toBe('ja')
  })

  it('lets the open hint speak for the agent before a prepared translation\'s source language', () => {
    expect(agentLanguage('zh-tw', 'zh-CN')).toBe('zh-TW')
    expect(agentLanguage(undefined, 'zh-CN')).toBe('zh-CN')
    expect(agentLanguage(null, undefined)).toBeUndefined()
    // A malformed hint is no hint.
    expect(agentLanguage('zh_TW', 'ja')).toBe('ja')
    // The hint takes the supplied tier: below frontmatter, above detection.
    expect(languages('かな\n', agentLanguage('ko', 'zh-CN')).document).toBe('ko')
    expect(languages('---\nlang: fr\n---\n\nかな\n', agentLanguage('ko', undefined)).document).toBe('fr')
  })

  it('detects kana, halfwidth katakana, and hangul before Han', () => {
    expect(languages('# 見出し\n\n本文です。\n').document).toBe('ja')
    expect(languages('ｶﾀｶﾅ\n').document).toBe('ja')
    expect(languages('한국어 문서\n').document).toBe('ko')
    expect(languages('中文文档。\n\n한국어\n\nかな\n').document).toBe('ja')
    expect(languages('中文文档，直令骨辺。\n').document).toBe('zh-CN')
    // Han beyond the Basic Multilingual Plane (U+20B9F).
    expect(languages('\u{20B9F}\n').document).toBe('zh-CN')
    // The katakana middle dot separates names in Chinese too.
    expect(languages('约翰・史密斯\n').document).toBe('zh-CN')
  })

  it('names the script most CJK blocks are in, so a quotation stays an exception', () => {
    const chineseQuotingJapanese = '中文文档。\n\n第二段中文。\n\n第三段中文。\n\n引用：これは日本語です。\n'
    expect(languages(chineseQuotingJapanese).document).toBe('zh-CN')
    expect(exceptions(chineseQuotingJapanese)).toEqual({ '引用：こ': 'ja' })
    // A Japanese document keeps its kanji-only headings Japanese.
    const japanese = '# 設計方針\n\nこれは本文です。\n\n## 概要\n\n次の段落もあります。\n\nもう一つの段落。\n'
    expect(languages(japanese)).toEqual({ document: 'ja', blocks: new Map() })
    const chineseQuotingKorean = '中文文档。\n\n第二段。\n\n한국어 인용\n'
    expect(languages(chineseQuotingKorean).document).toBe('zh-CN')
    expect(exceptions(chineseQuotingKorean)).toEqual({ '한국어 ': 'ko' })
    expect(languages('한국어 문서\n\n두 번째 문단\n\nかな\n').document).toBe('ko')
    // An even split goes to kana, then hangul.
    expect(languages('中文。\n\nかな\n').document).toBe('ja')
    expect(languages('中文。\n\n한국어\n').document).toBe('ko')
  })

  it('leaves a document with no CJK script and no declaration without a language', () => {
    expect(languages('# Plain\n\nLatin only, café.\n')).toEqual({ document: undefined, blocks: new Map() })
  })

  it('does not take a reviewer comment for the document language', () => {
    expect(languages('中文正文。{>>@reviewer: コメントです<<}\n').document).toBe('zh-CN')
    expect(languages('Plain {>>unclosed かな\n').document).toBe('ja')
  })

  it('tags a kana block in a non-Japanese document as Japanese', () => {
    const source = '中文段落。\n\n日本語の段落。\n\n- 列表项\n- リスト\n'
    expect(languages(source, 'zh-CN').document).toBe('zh-CN')
    expect(exceptions(source, 'zh-CN')).toEqual({ '日本語の': 'ja', '- リス': 'ja' })
    expect(exceptions('---\nlang: en\n---\n\nEnglish.\n\nひらがな\n')).toEqual({ 'ひらがな': 'ja' })
  })

  it('tags a hangul block in a non-Korean document as Korean, and kana in a Korean one as Japanese', () => {
    expect(exceptions('かなの文書。\n\n한국어 단락\n')).toEqual({ '한국어 ': 'ko' })
    expect(exceptions('한국어 문서\n\nかな\n', 'ko')).toEqual({ 'かな\n': 'ja' })
    // A block with both scripts is Japanese, so it is no exception in a Japanese document.
    expect(exceptions('かな\n\nかな 한국어\n')).toEqual({})
  })

  it('gives every other block the document language', () => {
    expect(exceptions('かなの文書。\n\n漢字の段落\n\nLatin.\n')).toEqual({})
    expect(exceptions('한국어\n\n漢字\n', 'ko')).toEqual({})
  })

  it('canonicalizes well-formed tags and rejects the rest', () => {
    expect(wellFormedLanguage('ZH-hant-hk')).toBe('zh-Hant-HK')
    expect(wellFormedLanguage('en_US')).toBeUndefined()
    expect(wellFormedLanguage(42)).toBeUndefined()
  })

  it('scans a large document from the parse the analysis already holds', () => {
    const block = '中文段落，含有足够的文字以填充这一行。{>>未闭合的评论 '
    const paragraphs = Array.from({ length: 20_000 }, (_, index) => index % 5000 === 4999 ? 'かなの段落。' : block)
    const source = paragraphs.join('\n\n')
    const analysis = analyzeMarkdown(source)
    parses.count = 0
    const started = performance.now()
    const resolved = resolveLanguages(scanScripts(source, analysis.plain), 'zh-CN')
    // Linear: a regression to a per-block search of the rest of the document takes seconds here.
    expect(performance.now() - started).toBeLessThan(1000)
    expect(parses.count).toBe(0)
    expect(resolved.document).toBe('zh-CN')
    expect(resolved.blocks.size).toBe(4)
  })
})
