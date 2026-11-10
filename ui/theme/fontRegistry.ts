import type { MsgKey } from '../i18n'

/**
 * CJK faces after the Latin face, by style and language: the Noto face for the language, then
 * system faces if it is not bundled or its slice cannot load. `zh` (Simplified) is the default; the
 * [contract](fonts.md) names which languages are bundled and which `:lang()` selects each.
 */
export const CJK_STACKS = {
  serif: {
    zh: ['Noto Serif SC', 'Songti SC', 'SimSun'],
    ja: ['Noto Serif JP', 'Hiragino Mincho ProN', 'Yu Mincho'],
    'zh-TW': ['Noto Serif TC', 'Songti TC', 'PMingLiU'],
    'zh-HK': ['Noto Serif HK', 'Songti TC', 'PMingLiU'],
    ko: ['Noto Serif KR', 'AppleMyungjo', 'Batang'],
  },
  sans: {
    zh: ['Noto Sans SC', 'PingFang SC', 'Microsoft YaHei'],
    ja: ['Noto Sans JP', 'Hiragino Sans', 'Yu Gothic'],
    'zh-TW': ['Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei'],
    'zh-HK': ['Noto Sans HK', 'PingFang HK', 'Microsoft JhengHei'],
    ko: ['Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic'],
  },
} as const

export type CjkStyle = keyof typeof CJK_STACKS
export type CjkLanguage = keyof typeof CJK_STACKS.serif

export const CJK_LANGUAGES = Object.keys(CJK_STACKS.serif) as CjkLanguage[]
/** The stack of `--font-display`, `--font-body`, and `--font-mono`, and of text with no CJK language. */
export const DEFAULT_CJK_LANGUAGE: CjkLanguage = 'zh'

/** A complete reading choice: every face the document needs. The [contract](fonts.md) explains. */
export interface FontPreset {
  id: string
  /** Interface message naming the preset in Settings. */
  label: Extract<MsgKey, `fontPreset${string}`>
  displayFamily: string
  displayWeight: number
  displayTracking: string
  bodyFamily: string
  /** Body weight on dark themes, where light text on a dark ground reads heavier; light themes use 400. */
  darkBodyWeight: number
  /** Serif or sans: picks the CJK faces and the generic family that follow the Latin face. */
  style: CjkStyle
  codeFamily: string
  codeWeight: number
}

/** `serif` is the default and matches the base tokens in `themes/common.css`. */
export const FONT_PRESETS: FontPreset[] = [
  {
    id: 'serif', label: 'fontPresetSerif', style: 'serif',
    displayFamily: 'Source Serif 4', displayWeight: 650, displayTracking: '-0.01em',
    bodyFamily: 'Source Serif 4', darkBodyWeight: 350, codeFamily: 'Source Code Pro', codeWeight: 500,
  },
  {
    id: 'sans', label: 'fontPresetSans', style: 'sans',
    displayFamily: 'Source Sans 3', displayWeight: 700, displayTracking: '-0.01em',
    bodyFamily: 'Source Sans 3', darkBodyWeight: 370, codeFamily: 'Source Code Pro', codeWeight: 500,
  },
  {
    id: 'hyperlegible', label: 'fontPresetHyperlegible', style: 'sans',
    displayFamily: 'Atkinson Hyperlegible Next', displayWeight: 700, displayTracking: '0',
    bodyFamily: 'Atkinson Hyperlegible Next', darkBodyWeight: 330, codeFamily: 'Atkinson Hyperlegible Mono', codeWeight: 400,
  },
]

export const DEFAULT_FONT_PRESET = FONT_PRESETS[0]!

export function isFontPresetId(id: string): boolean {
  return FONT_PRESETS.some((preset) => preset.id === id)
}

export function fontPresetById(id: string | undefined): FontPreset {
  return FONT_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_FONT_PRESET
}
