import { useEffect } from 'react'
import { requireReviewerHost, type FontPackReply } from '../app/host'
import { useConfig } from '../app/configStore'
import { announce } from '../app/Notifications'
import { DICTIONARIES } from '../i18n'
import { languageName } from '../translate/languages'
import { BUNDLED_CJK_LANGUAGES, CJK_LANGUAGES, CJK_STACKS, type CjkLanguage, type CjkStyle } from './fontRegistry'

/** The pack sheets beside the bundled face sheet; each declares its faces by bare file name. */
export const FONT_PACKS_HREF = '/themes/fonts/packs/'

/** The CJK rows whose leading faces arrive as packs rather than in the bundle. */
export const PACK_LANGUAGES = CJK_LANGUAGES.filter((language) => !BUNDLED_CJK_LANGUAGES.includes(language))

/** A pack is named after its family, as the package that ships it is: `Noto Sans KR` → `noto-sans-kr`. */
export function packName(family: string): string {
  return family.toLowerCase().replaceAll(' ', '-')
}

/**
 * The CJK rows of `ui/app/app.css` a language tag can select: `ko`; `zh-TW` for Taiwan or
 * Traditional script; `zh-HK` for Hong Kong. A tag such as `zh-Hant-HK` names both Traditional
 * rows, since engines differ on whether `:lang(zh-HK)` matches it.
 */
export function cjkRows(tag: string | undefined): CjkLanguage[] {
  if (!tag) return []
  const [primary, ...rest] = tag.toLowerCase().split('-')
  if (primary === 'ko') return ['ko']
  if (primary === 'ja') return ['ja']
  if (primary !== 'zh') return []
  const rows: CjkLanguage[] = []
  if (rest.includes('tw') || rest.includes('hant')) rows.push('zh-TW')
  if (rest.includes('hk')) rows.push('zh-HK')
  return rows.length ? rows : ['zh']
}

/**
 * The packs rendered text needs: the leading face, in the preset's style, of each pack row any of
 * `tags` selects. `tags` are the languages of the document, of its tagged blocks, and of a shown
 * translation.
 */
export function neededPacks(tags: Iterable<string | undefined>, style: CjkStyle): string[] {
  const names = new Set<string>()
  for (const tag of tags) {
    for (const row of cjkRows(tag)) {
      if (PACK_LANGUAGES.includes(row)) names.add(packName(CJK_STACKS[style][row][0]))
    }
  }
  return [...names].sort()
}

/** The language whose row a pack leads, for the notice that names it. */
function packLanguage(name: string): CjkLanguage | undefined {
  return PACK_LANGUAGES.find((language) =>
    (['serif', 'sans'] as const).some((style) => packName(CJK_STACKS[style][language][0]) === name))
}

type PackState = 'requested' | 'ready' | 'unavailable'

export interface FontPackLoaderOptions {
  /** The host's pack request; absent outside the desktop host, where nothing is fetched. */
  request(): ((name: string) => Promise<FontPackReply>) | undefined
  /** The pack's sheet text, with bare file names. */
  sheet(name: string): Promise<string>
  /** Called once per request that did not bring the pack; the reviewer's loader raises the notice. */
  unavailable(name: string): void
}

/**
 * Requests each needed pack once and installs its faces when it arrives. A pack that could not
 * arrive is requested again on the next need after the browser reports the network back; there is
 * no retry loop, and a relaunch starts afresh.
 */
export function createFontPackLoader(options: FontPackLoaderOptions) {
  const states = new Map<string, PackState>()
  const needs = new Map<string, number>()
  let disposed = false
  const load = async (name: string): Promise<void> => {
    const request = options.request()
    if (!request) return
    states.set(name, 'requested')
    try {
      const reply = await request(name)
      if (reply.status !== 'ready') throw new Error(reply.status)
      const css = (await options.sheet(name)).replace(/url\('([^']+)'\)/g, (_, file: string) => `url('${reply.url(file)}')`)
      if (disposed) return
      const style = document.createElement('style')
      style.dataset.fontPack = name
      style.textContent = css
      document.head.append(style)
      states.set(name, 'ready')
    } catch {
      if (disposed) return
      states.set(name, 'unavailable')
      options.unavailable(name)
    }
  }
  const online = (): void => {
    const unavailable = [...states].filter(([, state]) => state === 'unavailable').map(([name]) => name)
    for (const name of unavailable) {
      states.delete(name)
      if (needs.get(name)) void load(name)
    }
  }
  window.addEventListener('online', online)
  return {
    /** Records that rendered text needs `names` until the returned release runs. */
    need(names: readonly string[]): () => void {
      for (const name of names) {
        needs.set(name, (needs.get(name) ?? 0) + 1)
        if (!states.has(name)) void load(name)
      }
      return () => {
        for (const name of names) {
          const remaining = (needs.get(name) ?? 1) - 1
          if (remaining > 0) needs.set(name, remaining)
          else needs.delete(name)
        }
      }
    },
    state: (name: string): PackState | undefined => states.get(name),
    dispose(): void {
      disposed = true
      window.removeEventListener('online', online)
      for (const style of document.head.querySelectorAll('style[data-font-pack]')) style.remove()
      states.clear(); needs.clear()
    },
  }
}

/** One notice per language: the system faces stand until the network brings the pack. */
function announceUnavailable(name: string): void {
  const language = packLanguage(name)
  if (!language) return
  const dictionary = DICTIONARIES[useConfig.getState().config?.uiLang ?? 'en']
  announce(`font-pack:${language}`, dictionary.fontPackOffline.replace('{language}', languageName(language)))
}

let loader: ReturnType<typeof createFontPackLoader> | null = null

/** The reviewer's loader, bound to whichever host is installed when a pack is requested. */
export function fontPackLoader(): ReturnType<typeof createFontPackLoader> {
  loader ??= createFontPackLoader({
    request: () => {
      const host = requireReviewerHost()
      return host.fontPack?.bind(host)
    },
    sheet: async (name) => {
      const response = await fetch(`${FONT_PACKS_HREF}${name}.css`)
      if (!response.ok) throw new Error(`pack sheet ${name}: ${response.status}`)
      return response.text()
    },
    unavailable: announceUnavailable,
  })
  return loader
}

/** Forgets every pack and removes their faces; tests start from no packs. */
export function resetFontPacks(): void {
  loader?.dispose()
  loader = null
}

/**
 * Asks for the packs the given languages need in `style` while the calling view is mounted. The
 * text renders in the system faces after each Noto face meanwhile and re-renders when a pack's
 * faces are installed, with no reload.
 */
export function useFontPacks(tags: ReadonlyArray<string | undefined>, style: CjkStyle): void {
  const names = neededPacks(tags, style).join(' ')
  useEffect(() => (names ? fontPackLoader().need(names.split(' ')) : undefined), [names])
}
