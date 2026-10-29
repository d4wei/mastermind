import { usableAuthorName } from '../../document/author'
import { DEFAULT_CONFIG } from './defaults'
import type { MastermindConfig } from './types'

// Keyed by the union so a new interface language fails to compile until it is admitted here.
const UI_LANGUAGES: Record<MastermindConfig['uiLang'], true> = { en: true, 'zh-CN': true }

const knownKey = (key: string): key is keyof MastermindConfig => Object.hasOwn(DEFAULT_CONFIG, key)

/** A known preference value must have its default's type; numbers are finite and positive sizes. */
function acceptsConfigValue(key: keyof MastermindConfig, value: unknown): boolean {
  if (typeof value !== typeof DEFAULT_CONFIG[key]) return false
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (key === 'uiLang') return Object.hasOwn(UI_LANGUAGES, value as string)
  if (key === 'authorTag') return usableAuthorName(value as string) === value
  return true
}

/**
 * Stored preferences may be hand-edited, so each unacceptable field falls back to its default alone.
 * An author name is read normalized, as the native host normalizes it.
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
