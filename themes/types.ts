export interface ThemeFontInfo {
  family: string
  url: string
  weight: string | number
}

export interface ThemeInfo {
  id: string
  name: string
  appearance: 'light' | 'dark'
  grain: { enabled: boolean; opacity?: number; tintOpacity?: number } | null
  fonts: ThemeFontInfo[]
  /** Preview hexes for the picker swatch (theme's own bg / muted ink / accent). */
  swatch: { bg: string; ink: string; accent: string } | null
}
