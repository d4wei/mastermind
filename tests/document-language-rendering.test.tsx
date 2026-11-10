// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { resolveLanguages, scanScripts } from '../document/markdown/language'
import { prepareTranslation, type PreparedTranslation } from '../document/translation'
import { MarkdownView } from '../ui/modes/reading/Renderer'
import { installHost } from '../ui/app/host'
import { SessionView } from '../ui/app/SessionView'
import { useDoc } from '../ui/documents/store'
import { useTranslation } from '../ui/translate/translationStore'
import { fakeHost } from './helpers/host'
import { setDocumentLanguageHints, useDocumentLanguageHints } from '../ui/documents/language-hints'

vi.mock('../ui/app/ConflictPanel', () => ({ ConflictPanel: () => null }))
vi.mock('../ui/modes/source/SourceEditor', () => ({
  SourceEditor: ({ lang }: { lang?: string }) => <div className="source-host" lang={lang} />,
}))

/** The reading view of `source` as the document view renders it, with its blocks' languages. */
function rendered(source: string) {
  const analysis = analyzeMarkdown(source)
  const languages = resolveLanguages(scanScripts(source, analysis.plain))
  const host = document.createElement('article')
  host.innerHTML = renderToStaticMarkup(<MarkdownView analysis={analysis}
    ctx={{ source, blockLanguages: languages.blocks }} />)
  return { host, languages }
}
const tagged = (host: Element) => [...host.querySelectorAll('[lang]')]
  .map((element) => `${element.tagName.toLowerCase()} ${element.getAttribute('lang')}: ${element.textContent}`)

describe('block languages in the reading view', () => {
  it('tags no block of a Chinese, Japanese, or Latin-only document', () => {
    for (const source of ['# 标题\n\n中文段落。\n', '# 見出し\n\n本文です。\n\n漢字。\n', '# Title\n\nProse.\n']) {
      expect(tagged(rendered(source).host), source).toEqual([])
    }
  })

  it('tags the blocks of a mixed document whose script contradicts it', () => {
    const source = '---\nlang: zh-CN\n---\n\n# 标题\n\n中文段落。\n\n日本語の段落。\n\n- 列表\n- リスト\n\n> 한국어 인용\n'
    const { host, languages } = rendered(source)
    expect(languages.document).toBe('zh-CN')
    expect(tagged(host)).toEqual(['p ja: 日本語の段落。', 'li ja: リスト', 'blockquote ko: 한국어 인용'])
    // The language is an attribute only: text and source extents are those of the untagged view.
    const plain = document.createElement('article')
    plain.innerHTML = renderToStaticMarkup(<MarkdownView analysis={analyzeMarkdown(source)} ctx={{ source }} />)
    expect(host.textContent).toBe(plain.textContent)
    const extents = (root: Element) => [...root.querySelectorAll('[data-ps]')].map((el) =>
      `${el.getAttribute('data-ps')}-${el.getAttribute('data-pe')}`)
    expect(extents(host)).toEqual(extents(plain))
  })

  it('tags a kana block in a frontmatter-declared document, review marks and all', () => {
    const { host } = rendered('---\nlang: fr\n---\n\nBonjour.\n\nこんにちは{++、世界++}。\n')
    expect(tagged(host)).toEqual(['p ja: こんにちは、世界。'])
  })
})

describe('the document view', () => {
  const initial = useDoc.getState()
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    installHost(fakeHost())
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount()); host.remove(); useDoc.setState(initial); useTranslation.getState().release('A')
    useDocumentLanguageHints.setState({ hints: {} })
    vi.unstubAllGlobals(); installHost(null)
  })
  async function open(source: string) {
    useDoc.setState({ ...initial, sessionId: 'A', status: 'ready', mode: 'reading', source, savedSource: source,
      load: vi.fn().mockResolvedValue(undefined), meta: null })
    await act(async () => root.render(<SessionView sessionId="A" />))
  }
  async function prepare(source: string, sourceLang: string, targetLang: string): Promise<PreparedTranslation> {
    const prepared = await prepareTranslation(source)
    return { version: 1, sourceHash: prepared.sourceHash, sourceLang, targetLang,
      blocks: prepared.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id, text: 'Translated.' })) }
  }
  const article = () => host.querySelector('article.md-root')!

  it.each([
    ['Chinese', '# 标题\n\n中文段落。\n', 'zh-CN'],
    ['Japanese', '# 見出し\n\n本文です。\n', 'ja'],
    ['mixed', '中文段落。\n\n日本語の段落。\n', 'ja'],
    ['frontmatter-declared', '---\nlang: zh-TW\n---\n\n日本語の段落。\n', 'zh-TW'],
  ])('carries a %s document language on its root', async (_kind, source, lang) => {
    await open(source)
    expect(article().getAttribute('lang')).toBe(lang)
  })

  it('leaves a Latin-only document root without lang, inheriting the interface language', async () => {
    await open('# Title\n\nProse.\n')
    expect(article().hasAttribute('lang')).toBe(false)
  })

  it('carries the document language on the Markdown source editor root', async () => {
    await open('中文段落。\n')
    await act(async () => useDoc.getState().setMode('source'))
    await vi.waitFor(() => expect(host.querySelector('.source-host')).not.toBeNull())
    expect(host.querySelector('.source-host')!.getAttribute('lang')).toBe('zh-CN')
  })

  it('takes a prepared translation\'s source language before script detection', async () => {
    const source = '漢字の文書。\n\n中文漢字。\n'
    const artifact = await prepare(source, 'zh-CN', 'en')
    installHost(fakeHost({ translations: async () => [artifact] }))
    await open(source)
    await act(async () => useTranslation.getState().synchronize())
    // The supplied language speaks for the document; the kana block is still tagged for itself.
    expect(article().getAttribute('lang')).toBe('zh-CN')
    expect(tagged(article())).toEqual(['p ja: 漢字の文書。'])
  })

  it('takes the open hint before script detection and before a disagreeing source language', async () => {
    const source = '漢字の文書。\n\n中文漢字。\n'
    const artifact = await prepare(source, 'zh-CN', 'en')
    installHost(fakeHost({ translations: async () => [artifact] }))
    setDocumentLanguageHints([{ id: 'A', document_language: 'zh-TW' }, { id: 'B', document_language: null }])
    await open(source)
    await act(async () => useTranslation.getState().synchronize())
    expect(article().getAttribute('lang')).toBe('zh-TW')
    // Frontmatter still wins over the hint.
    await act(async () => useDoc.setState({ source: '---\nlang: ko\n---\n\n中文。\n' }))
    expect(article().getAttribute('lang')).toBe('ko')
    // Closing the document drops its hint, and the prepared translation's language speaks again.
    await act(async () => { setDocumentLanguageHints([]); useDoc.setState({ source }) })
    expect(article().getAttribute('lang')).toBe('zh-CN')
  })

  it('tags translated blocks with the target language and keeps the original\'s on literal blocks', async () => {
    const source = '中文段落。\n\n```\nコードのコメント\n```\n\n```\n中文代码\n```\n\n另一个段落。\n'
    const artifact = await prepare(source, 'zh-CN', 'en')
    installHost(fakeHost({ translations: async () => [artifact] }))
    await open(source)
    await act(async () => useTranslation.getState().select('en'))
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(host.querySelector('.trans-view .trans-block')).not.toBeNull()
    })
    const view = host.querySelector('.trans-view')!
    expect(view.getAttribute('lang')).toBe('zh-CN')
    expect([...view.querySelectorAll('.trans-block')].map((block) => [block.getAttribute('lang'), block.textContent]))
      .toEqual([['en', 'Translated.'], ['ja', 'コードのコメント'], [null, '中文代码'], ['en', 'Translated.']])
  })
})
