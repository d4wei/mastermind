import { DEFAULT_AUTHOR_TAG } from '../app/constants'
import { DEFAULT_FONT_PRESET } from '../theme/fontRegistry'
import type { MastermindConfig } from './types'

export const DEFAULT_CONFIG: MastermindConfig = {
  version: 1,
  theme: 'grid',
  fontSize: 16,
  lineHeight: 1.6,
  contentWidth: 736,
  authorTag: DEFAULT_AUTHOR_TAG,
  fontPreset: DEFAULT_FONT_PRESET.id,
  codeTheme: 'none',
  uiLang: 'en',
}
