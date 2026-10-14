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
  /** ID from the font preset registry in ui/theme/fontRegistry.ts */
  fontPreset: string
  /** id of the chosen monospace face (code, filenames, CriticMarkup source) */
  monoFont: string
  /** id of the chosen code-color scheme; `none` = uncolored (see ui/theme/codeThemes.ts) */
  codeTheme: string
  uiLang: 'en' | 'zh-CN'
  /** Optional personal language code for prepared reading translations. */
  translationLanguage: string | null
  /** per-theme grain overrides; `enabled` is the legacy on/off, superseded by `intensity` */
  grain: Record<string, { enabled?: boolean; intensity?: GrainIntensity; texture?: GrainTexture }>
}

export type ClientConfig = MastermindConfig

