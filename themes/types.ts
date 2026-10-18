export interface ThemeInfo {
  id: string
  name: string
  appearance: 'light' | 'dark'
  swatch: { bg: string; ink: string; accent: string }
}
