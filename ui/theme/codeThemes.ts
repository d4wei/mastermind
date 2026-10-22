import type { HlToken } from '../modes/reading/highlight'

type ColorTok = Exclude<HlToken['type'], 'text'>
export const COLOR_TOKS: ColorTok[] = ['comment', 'keyword', 'string', 'number', 'function', 'property', 'constant']

type Appearance = 'light' | 'dark'
type Palette = Record<ColorTok, string>

export type CodeThemeId = 'none' | 'soft' | 'vivid' | 'warm'

export interface CodeTheme {
  id: CodeThemeId
  /** null → no coloring (the default, current behavior) */
  palettes: Record<Appearance, Palette> | null
}

export const CODE_THEMES: CodeTheme[] = [
  { id: 'none', palettes: null },
  {
    id: 'soft',
    palettes: {
      light: { comment: '#666c71', keyword: '#855b9a', string: '#4b754b', number: '#8e632e', function: '#436e9f', property: '#606b79', constant: '#9b5758' },
      dark: { comment: '#9fa5ae', keyword: '#c4a7e7', string: '#a3c9a8', number: '#e0bb7a', function: '#8fb6e8', property: '#aab4c0', constant: '#e0a0a0' },
    },
  },
  {
    id: 'vivid',
    palettes: {
      light: { comment: '#6a6b71', keyword: '#a626a4', string: '#277b29', number: '#926200', function: '#2e63db', property: '#c4372e', constant: '#926200' },
      dark: { comment: '#9fa4ae', keyword: '#d586ec', string: '#98c379', number: '#d19a66', function: '#61afef', property: '#f78088', constant: '#d19a66' },
    },
  },
  {
    id: 'warm',
    palettes: {
      light: { comment: '#766854', keyword: '#9d0006', string: '#736e00', number: '#8f3f71', function: '#9a5d00', property: '#076678', constant: '#8f3f71' },
      dark: { comment: '#b1a192', keyword: '#ff7e65', string: '#b8bb26', number: '#db8ea3', function: '#fabd2f', property: '#89ab9e', constant: '#db8ea3' },
    },
  },
]

export function codeThemeById(id: string | undefined): CodeTheme {
  return CODE_THEMES.find((c) => c.id === id) ?? CODE_THEMES[0]!
}

/** The `--code-*` custom properties for a scheme on a given appearance, or null for `none`. */
export function codeThemeVars(theme: CodeTheme, appearance: Appearance): Record<string, string> | null {
  const pal = theme.palettes?.[appearance]
  if (!pal) return null
  return Object.fromEntries(COLOR_TOKS.map((tok) => [`--code-${tok}`, pal[tok]]))
}
