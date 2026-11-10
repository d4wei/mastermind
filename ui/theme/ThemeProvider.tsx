import { useEffect, useRef } from 'react'
import { syncHostAppearance } from './appearance'
import { useConfig } from '../app/configStore'
import { FONT_FACES_HREF, fontFamilyTokens, fontPresetById } from './fonts'
import { prefersReducedMotion } from '../util/presence'
import { COLOR_TOKS, codeThemeById, codeThemeVars } from './codeThemes'

const TOKENS_LINK_ID = 'theme-tokens'
const FONTS_LINK_ID = 'theme-fonts'

/** Applies theme + per-user overrides to the document. Render once in App. */
export function ThemeEffects() {
  const config = useConfig((s) => s.config)
  const themes = useConfig((s) => s.themes)

  const themeId = config?.theme ?? 'grid'
  const theme = themes.find((t) => t.id === themeId) ?? themes[0]
  // The first configured theme replaces the startup default instantly; only later choices cross-fade.
  const configuredThemeShown = useRef(false)

  // Keep the previous background visible while the replacement stylesheet loads.
  useEffect(() => {
    const id = theme?.id ?? themeId
    const root = document.documentElement
    const prev = root.dataset.theme
    const synchronize = () => syncHostAppearance(theme?.appearance ?? 'light')
    const href = `/themes/${id}/tokens.css`
    let link = document.getElementById(TOKENS_LINK_ID) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = TOKENS_LINK_ID
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    if (prev === id && link.href.endsWith(href)) {
      if (link.sheet) synchronize()
      else link.addEventListener('load', synchronize, { once: true })
      return () => link?.removeEventListener('load', synchronize)
    }

    const reduce = prefersReducedMotion()
    let veil: HTMLDivElement | null = null
    if (configuredThemeShown.current && prev && prev !== id && !reduce) {
      veil = document.createElement('div')
      veil.className = 'theme-veil'
      veil.style.background = getComputedStyle(document.body).backgroundColor
      document.body.appendChild(veil)
    }
    root.dataset.theme = id

    let settled = false
    const reveal = (): void => {
      if (settled) return
      settled = true
      if (!veil) return
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!veil) return
          veil.style.opacity = '0'
          setTimeout(() => veil?.remove(), 360)
        }),
      )
    }
    const loaded = (): void => { synchronize(); reveal() }
    link.onload = loaded
    if (!link.href.endsWith(href)) link.href = href
    else if (link.sheet) loaded()
    const fallback = veil ? setTimeout(reveal, 220) : undefined
    return () => {
      clearTimeout(fallback)
      if (link.onload === loaded) link.onload = null
      veil?.remove()
    }
  }, [theme?.id, theme?.appearance, themeId])
  useEffect(() => { if (config) configuredThemeShown.current = true }, [config])

  // The desktop page links the face sheet before scripts run; this covers pages that do not.
  useEffect(() => {
    if (document.getElementById(FONTS_LINK_ID)) return
    const link = document.createElement('link')
    link.id = FONTS_LINK_ID
    link.rel = 'stylesheet'
    link.href = FONT_FACES_HREF
    document.head.appendChild(link)
  }, [])

  // Personal overrides remain independent of the selected theme.
  useEffect(() => {
    if (!config) return
    const root = document.documentElement.style
    root.setProperty('--font-size-body', `${config.fontSize / 16}rem`)
    root.setProperty('--lh-body', String(config.lineHeight))
    root.setProperty('--content-max-width', `${config.contentWidth / 16}rem`)

    const preset = fontPresetById(config.fontPreset)
    for (const [name, value] of Object.entries(fontFamilyTokens(preset))) root.setProperty(name, value)
    // Light themes keep the base weight from `themes/common.css`.
    if (theme?.appearance === 'dark') root.setProperty('--weight-body', String(preset.darkBodyWeight))
    else root.removeProperty('--weight-body')
    root.setProperty('--weight-bold', String(preset.displayWeight))
    root.setProperty('--ls-heading', preset.displayTracking)
    root.setProperty('--weight-code', String(preset.codeWeight))

    // `none` clears the --code-* tokens; the renderer also skips tokenizing for it.
    const vars = codeThemeVars(codeThemeById(config.codeTheme), theme?.appearance ?? 'light')
    for (const tok of COLOR_TOKS) {
      const name = `--code-${tok}`
      if (vars) root.setProperty(name, vars[name]!)
      else root.removeProperty(name)
    }
  }, [config, theme?.appearance])

  return null
}
