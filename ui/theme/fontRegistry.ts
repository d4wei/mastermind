import type { MsgKey } from '../i18n'

/** CJK faces after the Latin face: the bundled Noto face, then system faces if its slice cannot load. */
export const CJK_STACKS = {
  serif: ['Noto Serif SC', 'Songti SC', 'SimSun'],
  sans: ['Noto Sans SC', 'PingFang SC', 'Microsoft YaHei'],
} as const

export type CjkStyle = keyof typeof CJK_STACKS

/** A complete reading choice: every face the document needs. The [contract](fonts.md) explains. */
export interface FontPreset {
  id: string
  /** Interface message naming the preset in Settings. */
  label: Extract<MsgKey, `fontPreset${string}`>
  displayFamily: string
  displayWeight: number
  displayTracking: string
  bodyFamily: string
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
    bodyFamily: 'Source Serif 4', codeFamily: 'Source Code Pro', codeWeight: 500,
  },
  {
    id: 'sans', label: 'fontPresetSans', style: 'sans',
    displayFamily: 'Source Sans 3', displayWeight: 700, displayTracking: '-0.01em',
    bodyFamily: 'Source Sans 3', codeFamily: 'Source Code Pro', codeWeight: 500,
  },
  {
    id: 'hyperlegible', label: 'fontPresetHyperlegible', style: 'sans',
    displayFamily: 'Atkinson Hyperlegible Next', displayWeight: 700, displayTracking: '0',
    bodyFamily: 'Atkinson Hyperlegible Next', codeFamily: 'Atkinson Hyperlegible Mono', codeWeight: 400,
  },
]

export const DEFAULT_FONT_PRESET = FONT_PRESETS[0]!

export function isFontPresetId(id: string): boolean {
  return FONT_PRESETS.some((preset) => preset.id === id)
}

export function fontPresetById(id: string | undefined): FontPreset {
  return FONT_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_FONT_PRESET
}
