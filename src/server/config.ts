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
  typeSet: 'grid',
  monoFont: 'geist',
  codeTheme: 'none',
  uiLang: 'en',
  langPair: { a: 'English', b: 'Simplified Chinese' },
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
  let parsed: Partial<MastermindConfig> = {}
  try {
    parsed = JSON.parse(fs.readFileSync(configFilePath(), 'utf8')) as Partial<MastermindConfig>
  } catch {
    // Missing or unreadable preferences use the same defaults as a new install.
  }
  const authorTag = parsed?.authorTag ?? gitAuthorTag()
  return { ...DEFAULT_CONFIG, ...parsed, authorTag, version: 1 }
}

function persist(config: MastermindConfig): void {
  const dir = ensureConfigDir()
  const tmp = path.join(dir, `.config.json.${process.pid}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2))
  fs.renameSync(tmp, configFilePath())
}

export type ConfigPatch = Partial<Omit<MastermindConfig, 'version'>>

export function updateConfig(patch: ConfigPatch): MastermindConfig {
  const next: MastermindConfig = { ...readConfig(), ...patch, version: 1 }
  persist(next)
  return next
}

/** The browser sees the whole config — there are no secrets to redact. */
export function redactConfig(config: MastermindConfig): ClientConfig {
  return config
}
