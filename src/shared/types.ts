/** A single splice on a source string. `from`/`to` are UTF-16 code-unit offsets. */
export interface TextEdit {
  from: number
  to: number
  insert: string
}

export interface SessionMeta {
  sessionId: string
  path: string
  displayName: string
  mtimeMs: number
}

export interface FileResponse {
  content: string
  mtimeMs: number
  version: string
}

/* ---- config ---- */

/** Film-grain density steps; `off` supersedes the legacy on/off toggle. */
export type GrainIntensity = 'off' | 'low' | 'medium' | 'high'
/** Film-grain texture presets (feTurbulence parameter sets). */
export type GrainTexture = 'fine' | 'soft' | 'coarse'

export interface MastermindConfig {
  version: 1
  theme: string
  /** px */
  fontSize: number
  lineHeight: number
  /** px */
  contentWidth: number
  authorTag: string
  /** ID from the font preset registry in src/shared/fonts.ts */
  fontPreset: string
  /** id of the chosen monospace face (code, filenames, CriticMarkup source) */
  monoFont: string
  /** id of the chosen code-color scheme; `none` = uncolored (see src/shared/codeThemes.ts) */
  codeTheme: string
  uiLang: 'en' | 'zh-CN'
  /** Optional personal language code for prepared reading translations. */
  translationLanguage: string | null
  /** per-theme grain overrides; `enabled` is the legacy on/off, superseded by `intensity` */
  grain: Record<string, { enabled?: boolean; intensity?: GrainIntensity; texture?: GrainTexture }>
}

export type ClientConfig = MastermindConfig

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
