import { DEFAULT_AUTHOR_TAG } from '../app/constants'
import type { MastermindConfig } from './types'

export const DEFAULT_CONFIG: MastermindConfig = {
  version: 1,
  theme: 'grid',
  fontSize: 16,
  lineHeight: 1.6,
  contentWidth: 736,
  authorTag: DEFAULT_AUTHOR_TAG,
  fontPreset: 'grid',
  monoFont: 'geist',
  codeTheme: 'none',
  uiLang: 'en',
  translationLanguage: null,
  grain: {},
}
