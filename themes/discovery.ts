import fs from 'node:fs/promises'
import path from 'node:path'
import postcss from 'postcss'
import type { ThemeInfo } from './types'

/** The reviewer serves and ships the themes tree without its TypeScript sources and Markdown docs. */
export function isThemeAsset(file: string): boolean {
  return !/\.(?:ts|md)$/i.test(file)
}

/**
 * The real path of the theme asset named by `relPath` inside `themesDir`, or null when the name is
 * excluded or the target is missing, not a regular file, or resolves outside `themesDir` lexically
 * or through a link.
 */
export async function resolveThemeAsset(themesDir: string, relPath: string): Promise<string | null> {
  if (relPath.includes('\0') || !isThemeAsset(relPath)) return null
  const within = (root: string, target: string): boolean => {
    const relative = path.relative(root, target)
    return relative !== '' && relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative)
  }
  try {
    const root = await fs.realpath(themesDir)
    const target = path.resolve(root, relPath)
    if (!within(root, target)) return null
    const real = await fs.realpath(target)
    if (!within(root, real) || !isThemeAsset(real) || !(await fs.stat(real)).isFile()) return null
    return real
  } catch {
    return null
  }
}

function paletteMetadata(css: string): Pick<ThemeInfo, 'appearance' | 'swatch'> {
  const colors = new Map<string, string>()
  postcss.parse(css).walkDecls((decl) => { colors.set(decl.prop, decl.value) })
  const color = (name: string): string => {
    const value = colors.get(`--color-${name}`)
    if (!value || value.includes('var(')) throw new Error(`Theme must define a literal --color-${name}`)
    return value
  }
  const appearance = colors.get('color-scheme')
  if (appearance !== 'light' && appearance !== 'dark') throw new Error('Theme must declare light or dark color-scheme')
  return { appearance, swatch: { bg: color('bg'), ink: color('text-muted'), accent: color('accent') } }
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
      const [jsonRaw, css] = await Promise.all([
        fs.readFile(path.join(dir, 'theme.json'), 'utf8'),
        fs.readFile(path.join(dir, 'tokens.css'), 'utf8'),
      ])
      const parsed: unknown = JSON.parse(jsonRaw)
      const name = parsed && typeof parsed === 'object' && 'name' in parsed ? parsed.name : undefined
      out.push({
        id,
        name: typeof name === 'string' && name !== '' ? name : id,
        ...paletteMetadata(css),
      })
    } catch (err) {
      console.error(`theme ${id} skipped:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}
