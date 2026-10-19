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
}

export type ClientConfig = MastermindConfig

