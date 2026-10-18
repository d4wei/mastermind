import fs from 'node:fs/promises'
import path from 'node:path'
import type { ThemeFontInfo, ThemeInfo } from './types'

interface ThemeJson {
  id?: string
  name?: string
  appearance?: string
  fonts?: Array<{ family?: string; src?: string; weight?: string | number }>
  swatch?: { bg?: unknown; ink?: unknown; accent?: unknown }
}

function parseSwatch(s: ThemeJson['swatch']): ThemeInfo['swatch'] {
  if (!s) return null
  const { bg, ink, accent } = s
  if (typeof bg === 'string' && typeof ink === 'string' && typeof accent === 'string') {
    return { bg, ink, accent }
  }
  return null
}

/**
 * Font srcs in theme.json are theme-relative ("/fonts/X.woff2" lives in the
 * theme's own folder); an explicit "/themes/..." src may reference another
 * theme's files.
 */
function resolveFontUrl(themeId: string, src: string): string {
  if (src.startsWith('/themes/')) return src
  return `/themes/${themeId}${src.startsWith('/') ? '' : '/'}${src}`
}

export async function scanThemes(themesDir: string): Promise<ThemeInfo[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(themesDir)
  } catch {
    return []
  }
  const out: ThemeInfo[] = []
  for (const id of entries.sort()) {
    const dir = path.join(themesDir, id)
    try {
      const st = await fs.stat(dir)
      if (!st.isDirectory()) continue
      await fs.access(path.join(dir, 'theme.json'))
    } catch {
      continue
    }
    try {
      const [jsonRaw] = await Promise.all([
        fs.readFile(path.join(dir, 'theme.json'), 'utf8'),
        fs.access(path.join(dir, 'tokens.css')),
      ])
      const parsed = JSON.parse(jsonRaw) as ThemeJson
      const fonts: ThemeFontInfo[] = []
      for (const f of parsed.fonts ?? []) {
        if (!f.family || !f.src) continue
        fonts.push({ family: f.family, url: resolveFontUrl(id, f.src), weight: f.weight ?? 400 })
      }
      out.push({
        id,
        name: parsed.name ?? id,
        appearance: parsed.appearance === 'dark' ? 'dark' : 'light',
        fonts,
        swatch: parseSwatch(parsed.swatch),
      })
    } catch (err) {
      console.error(`theme ${id} skipped:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}
