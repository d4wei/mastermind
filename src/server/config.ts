import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { DEFAULT_AUTHOR_TAG } from '../shared/constants'
import type { ClientConfig, MastermindConfig } from '../shared/types'
import { configFilePath, ensureConfigDir } from './paths'

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
  browser: '',
  grain: {},
}

function gitAuthorTag(): string {
  try {
    // Config is shared across workspaces; a repository's identity must not become its default.
    const name = execFileSync('git', ['config', '--global', '--get', 'user.name'], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const tag = name.trim().replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    return tag || DEFAULT_AUTHOR_TAG
  } catch {
    return DEFAULT_AUTHOR_TAG
  }
}

export function readConfig(): MastermindConfig {
  let parsed: Record<string, unknown> = {}
  try {
    const value: unknown = JSON.parse(fs.readFileSync(configFilePath(), 'utf8'))
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>
    }
  } catch {
    // Missing or unreadable preferences use the same defaults as a new install.
  }
  const authorTag = typeof parsed.authorTag === 'string' ? parsed.authorTag : gitAuthorTag()
  const known = Object.fromEntries(Object.keys(DEFAULT_CONFIG)
    .filter((key) => Object.hasOwn(parsed, key))
    .map((key) => [key, parsed[key]]))
  // Presence matters: an explicit null means original-only reading, even beside an old value.
  const language = Object.hasOwn(parsed, 'translationLanguage') ? parsed.translationLanguage : parsed.comfortLang
  const preset = Object.hasOwn(parsed, 'fontPreset') ? parsed.fontPreset : parsed.typeSet
  const translationLanguage = typeof language === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(language)
    ? language : null
  const fontPreset = typeof preset === 'string' && preset !== '' ? preset : DEFAULT_CONFIG.fontPreset
  return { ...DEFAULT_CONFIG, ...known, authorTag, translationLanguage, fontPreset, version: 1 }
}

function persist(config: MastermindConfig): void {
  const dir = ensureConfigDir()
  const tmp = path.join(dir, `.config.json.${process.pid}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2))
  fs.renameSync(tmp, configFilePath())
}

export type ConfigPatch = Partial<Omit<MastermindConfig, 'version'>>

export function updateConfig(patch: ConfigPatch): MastermindConfig {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('expected a configuration object')
  for (const key of Object.keys(patch)) {
    if (key === 'version' || !Object.hasOwn(DEFAULT_CONFIG, key)) throw new Error(`unknown config key: ${key}`)
  }
  if (patch.translationLanguage !== undefined && patch.translationLanguage !== null &&
    (typeof patch.translationLanguage !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(patch.translationLanguage))) {
    throw new Error('translationLanguage must be null or a language code')
  }
  if (patch.fontPreset !== undefined && (typeof patch.fontPreset !== 'string' || patch.fontPreset === '')) {
    throw new Error('fontPreset must be a nonempty preset ID')
  }
  const next: MastermindConfig = { ...readConfig(), ...patch, version: 1 }
  persist(next)
  return next
}

/** The browser sees the whole config — there are no secrets to redact. */
export function redactConfig(config: MastermindConfig): ClientConfig {
  return config
}
