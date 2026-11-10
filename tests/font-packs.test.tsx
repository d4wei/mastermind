// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installHost, type FontPackReply } from '../ui/app/host'
import { useConfig } from '../ui/app/configStore'
import { useAnnouncements } from '../ui/app/Notifications'
import { SessionView } from '../ui/app/SessionView'
import { createNativeHost } from '../ui/desktop/host'
import { useDoc } from '../ui/documents/store'
import { DEFAULT_CONFIG } from '../ui/settings/defaults'
import { CJK_STACKS } from '../ui/theme/fontRegistry'
import { cjkRows, createFontPackLoader, neededPacks, PACK_LANGUAGES, packName, resetFontPacks }
  from '../ui/theme/fontPacks'
import { useTranslation } from '../ui/translate/translationStore'
import { fakeHost } from './helpers/host'

vi.mock('../ui/app/ConflictPanel', () => ({ ConflictPanel: () => null }))

const manifest = JSON.parse(readFileSync(path.resolve('themes/fonts/packs/manifest.json'), 'utf8')) as {
  packs: Record<string, { family: string; sheet: string; files: string[] }>
}
const sheetOf = (name: string) => readFileSync(path.resolve('themes/fonts/packs', `${name}.css`), 'utf8')
const installed = () => [...document.head.querySelectorAll<HTMLStyleElement>('style[data-font-pack]')]
  .map((style) => style.dataset.fontPack)
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })

describe('which packs rendered text needs', () => {
  it('maps a language to the rows of the :lang() rules', () => {
    expect(cjkRows('ko-KR')).toEqual(['ko'])
    expect(cjkRows('zh-TW')).toEqual(['zh-TW'])
    expect(cjkRows('zh-Hant')).toEqual(['zh-TW'])
    expect(cjkRows('zh-HK')).toEqual(['zh-HK'])
    expect(cjkRows('zh-Hant-HK')).toEqual(['zh-TW', 'zh-HK'])
    expect(cjkRows('zh-CN')).toEqual(['zh'])
    expect(cjkRows('ja')).toEqual(['ja'])
    expect(cjkRows('fr')).toEqual([])
    expect(cjkRows(undefined)).toEqual([])
  })

  it('names the leading face of the preset style for each pack language, once', () => {
    expect(neededPacks(['zh-TW', 'ko', 'ko', undefined], 'serif')).toEqual(['noto-serif-kr', 'noto-serif-tc'])
    expect(neededPacks(['zh-HK'], 'sans')).toEqual(['noto-sans-hk'])
    // Bundled and non-CJK languages need nothing.
    expect(neededPacks(['zh-CN', 'ja', 'en', undefined], 'sans')).toEqual([])
  })

  it('has a manifest entry for every pack face and for nothing else', () => {
    const faces = PACK_LANGUAGES.flatMap((language) => [CJK_STACKS.serif[language][0], CJK_STACKS.sans[language][0]])
    expect(Object.keys(manifest.packs).sort()).toEqual(faces.map(packName).sort())
    for (const family of faces) expect(manifest.packs[packName(family)]!.family).toBe(family)
  })
})

describe('the pack loader', () => {
  let loader: ReturnType<typeof createFontPackLoader>
  afterEach(() => { loader.dispose(); vi.unstubAllGlobals() })

  function loaderWith(request: ((name: string) => Promise<FontPackReply>) | undefined) {
    const unavailable = vi.fn()
    loader = createFontPackLoader({ request: () => request, sheet: async (name) => sheetOf(name), unavailable })
    return unavailable
  }

  it('requests a pack once however often it is needed, and installs its faces when it is ready', async () => {
    let ready!: () => void
    const request = vi.fn((name: string) => new Promise<FontPackReply>((resolve) => {
      ready = () => resolve({ status: 'ready', url: (file) => `asset://localhost/cache/${name}/${file}` })
    }))
    loaderWith(request)
    const releases = [loader.need(['noto-sans-kr']), loader.need(['noto-sans-kr'])]
    expect(request).toHaveBeenCalledTimes(1)
    expect(installed()).toEqual([])
    await act(async () => ready())
    await settle()
    expect(installed()).toEqual(['noto-sans-kr'])
    const css = document.head.querySelector('style[data-font-pack]')!.textContent!
    const files = manifest.packs['noto-sans-kr']!.files
    expect(css).toContain(`src: url('asset://localhost/cache/noto-sans-kr/${files[0]}') format('woff2')`)
    expect(css.match(/url\('/g)).toHaveLength(files.length)
    expect(css).toContain("font-family: 'Noto Sans KR'")
    releases.forEach((release) => release())
    loader.need(['noto-sans-kr'])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('reports a pack that cannot arrive once, and asks again only on a need after the network returns', async () => {
    const request = vi.fn(async (_name: string): Promise<FontPackReply> => ({ status: 'offline' }))
    const unavailable = loaderWith(request)
    const release = loader.need(['noto-serif-tc'])
    loader.need(['noto-serif-hk'])()
    await settle()
    expect(unavailable.mock.calls).toEqual([['noto-serif-tc'], ['noto-serif-hk']])
    expect(installed()).toEqual([])
    // Still offline: another need asks nothing.
    loader.need(['noto-serif-tc'])()
    expect(request).toHaveBeenCalledTimes(2)
    // The network returns: a pack still needed is asked for at once; one no longer needed waits.
    request.mockResolvedValue({ status: 'ready', url: (file) => file })
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await settle()
    expect(request.mock.calls.map(([name]) => name)).toEqual(['noto-serif-tc', 'noto-serif-hk', 'noto-serif-tc'])
    expect(installed()).toEqual(['noto-serif-tc'])
    loader.need(['noto-serif-hk'])
    await settle()
    expect(installed()).toEqual(['noto-serif-tc', 'noto-serif-hk'])
    release()
  })

  it('fetches nothing where the host cannot fetch packs', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const unavailable = loaderWith(undefined)
    loader.need(['noto-sans-tc'])
    await settle()
    expect(unavailable).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(installed()).toEqual([])
  })
})

describe('packs in the document view', () => {
  const initial = useDoc.getState()
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const name = /packs\/([a-z-]+)\.css$/.exec(url)?.[1]
      return name ? new Response(sheetOf(name)) : new Response('', { status: 404 })
    }))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount()); host.remove(); useDoc.setState(initial); useTranslation.getState().release('A')
    useConfig.setState({ config: null })
    useAnnouncements.setState({ items: [] })
    resetFontPacks()
    vi.unstubAllGlobals(); installHost(null)
  })
  async function open(source: string, fontPack?: (name: string) => Promise<FontPackReply>) {
    installHost(fakeHost(fontPack ? { fontPack } : {}))
    useDoc.setState({ ...initial, sessionId: 'A', status: 'ready', mode: 'reading', source, savedSource: source,
      load: vi.fn().mockResolvedValue(undefined), meta: null })
    await act(async () => root.render(<SessionView sessionId="A" />))
    await settle()
  }

  it('asks once for the face of the preset style, and for the other style when the preset changes', async () => {
    const fontPack = vi.fn(async (_name: string): Promise<FontPackReply> => ({ status: 'ready', url: (file) => file }))
    await open('---\nlang: zh-TW\n---\n\n繁體中文段落。\n\n한국어 인용\n', fontPack)
    expect(fontPack.mock.calls.map(([name]) => name)).toEqual(['noto-serif-kr', 'noto-serif-tc'])
    expect(installed().sort()).toEqual(['noto-serif-kr', 'noto-serif-tc'])
    // The view re-renders with its text in the arrived faces; an edit asks nothing more.
    expect(host.querySelector('article.md-root')!.getAttribute('lang')).toBe('zh-TW')
    await act(async () => useDoc.setState({ source: '---\nlang: zh-TW\n---\n\n繁體中文。\n\n한국어\n' }))
    await settle()
    expect(fontPack).toHaveBeenCalledTimes(2)
    await act(async () => useConfig.setState({ config: { ...DEFAULT_CONFIG, fontPreset: 'sans' } }))
    await settle()
    expect(fontPack.mock.calls.map(([name]) => name).slice(2)).toEqual(['noto-sans-kr', 'noto-sans-tc'])
    expect(useAnnouncements.getState().items).toEqual([])
  })

  it('needs nothing for a document in a bundled language', async () => {
    const fontPack = vi.fn(async (_name: string): Promise<FontPackReply> => ({ status: 'ready', url: (file) => file }))
    await open('中文段落。\n\n日本語の段落。\n', fontPack)
    expect(fontPack).not.toHaveBeenCalled()
  })

  it('keeps the system faces and raises one notice for the language when the pack cannot arrive', async () => {
    useConfig.setState({ config: { ...DEFAULT_CONFIG, uiLang: 'en' } })
    const fontPack = vi.fn(async (_name: string): Promise<FontPackReply> => ({ status: 'offline' }))
    await open('---\nlang: ko\n---\n\n한국어 문서.\n', fontPack)
    expect(fontPack).toHaveBeenCalledTimes(1)
    expect(installed()).toEqual([])
    expect(useAnnouncements.getState().items.map(({ id, text }) => [id, text])).toEqual([
      ['font-pack:ko', 'Fonts for 한국어 will arrive when the network does. Until then, system fonts stand in.'],
    ])
  })

  it('fetches nothing outside the desktop host', async () => {
    await open('---\nlang: zh-HK\n---\n\n香港中文。\n')
    expect(fetch).not.toHaveBeenCalled()
    expect(installed()).toEqual([])
    expect(useAnnouncements.getState().items).toEqual([])
  })
})

describe('the desktop host', () => {
  it('asks the native host for a pack by name and resolves its files through the asset protocol', async () => {
    const invoke = vi.fn(async () => ({ status: 'ready', directory: '/cache/font-packs/noto-sans-kr-5.3.1/' }))
    const host = createNativeHost({ invoke: invoke as never, listen: vi.fn(),
      assetUrl: (file) => `asset://localhost/${encodeURIComponent(file)}` }, [])
    const reply = await host.fontPack!('noto-sans-kr')
    expect(invoke).toHaveBeenCalledWith('font_pack', { name: 'noto-sans-kr' })
    expect(reply.status === 'ready' && reply.url('a.woff2'))
      .toBe(`asset://localhost/${encodeURIComponent('/cache/font-packs/noto-sans-kr-5.3.1/a.woff2')}`)
    invoke.mockResolvedValueOnce({ status: 'offline' } as never)
    expect(await host.fontPack!('noto-sans-kr')).toEqual({ status: 'offline' })
  })

  it('offers no pack request without the asset protocol', () => {
    expect(createNativeHost({ invoke: vi.fn(), listen: vi.fn() }, []).fontPack).toBeUndefined()
  })
})
