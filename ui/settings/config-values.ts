import { usableAuthorName } from '../../document/author'
import { isFontPresetId } from '../theme/fontRegistry'
import { isUiLang } from '../i18n/languages'
import { DEFAULT_CONFIG } from './defaults'
import type { MastermindConfig } from './types'

const knownKey = (key: string): key is keyof MastermindConfig => Object.hasOwn(DEFAULT_CONFIG, key)

/** A known preference value must have its default's type; numbers are finite and positive sizes. */
function acceptsConfigValue(key: keyof MastermindConfig, value: unknown): boolean {
  if (typeof value !== typeof DEFAULT_CONFIG[key]) return false
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (key === 'uiLang') return isUiLang(value)
  if (key === 'authorTag') return usableAuthorName(value as string) === value
  if (key === 'fontPreset') return isFontPresetId(value as string)
  return true
}

/**
 * Stored preferences may be hand-edited, so each unacceptable field falls back to its default alone.
 * An author name is read normalized, as the native host normalizes it. Unknown keys, including the
 * retired `monoFont`, are not read; a font preset no longer in the registry reads as the default.
 */
export function storedConfig(saved: unknown): MastermindConfig {
  const config: Record<string, unknown> = { ...DEFAULT_CONFIG }
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [key, value] of Object.entries(saved)) {
      if (!knownKey(key) || key === 'version') continue
      const accepted = key === 'authorTag' && typeof value === 'string' ? usableAuthorName(value) : value
      if (accepted !== null && acceptsConfigValue(key, accepted)) config[key] = accepted
    }
  }
  return config as unknown as MastermindConfig
}
