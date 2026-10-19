import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { matchPreparedTranslation, prepareTranslation, type PreparedTranslation } from '../../document/translation'

export function validLanguageCode(code: string): boolean {
  return code.length <= 64 && /^[A-Za-z][A-Za-z0-9_-]*$/.test(code)
}

export function translationFile(realPath: string, targetLang: string): string {
  if (!validLanguageCode(targetLang)) throw new Error('invalid target language code')
  return path.join(path.dirname(realPath), '.mastermind', 'translations', `${path.basename(realPath)}.${targetLang}.json`)
}

export async function planTranslation(realPath: string, source: string, sourceLang: string, targetLang: string) {
  if (!validLanguageCode(sourceLang) || !validLanguageCode(targetLang)) throw new Error('explicit language codes required')
  return { version: 1 as const, ...(await prepareTranslation(source)), sourceLang, targetLang,
    artifactPath: translationFile(realPath, targetLang) }
}

export async function savePreparedTranslation(realPath: string, source: string, sourceLang: string,
  targetLang: string, input: unknown): Promise<{ artifactPath: string; written: number }> {
  if (!validLanguageCode(sourceLang) || !validLanguageCode(targetLang)) throw new Error('explicit language codes required')
  const artifact = await matchPreparedTranslation(source, input)
  if (!artifact || artifact.sourceLang !== sourceLang || artifact.targetLang !== targetLang) {
    throw new Error('translation must match the current source, languages, and complete block structure')
  }
  const artifactPath = translationFile(realPath, targetLang)
  await fs.mkdir(path.dirname(artifactPath), { recursive: true })
  const temporary = `${artifactPath}.${crypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(artifact), { flag: 'wx', mode: 0o600 })
    // Recheck freshness after preparation and before replacing the saved translation.
    const currentSource = await fs.readFile(realPath, 'utf8')
    if (!(await matchPreparedTranslation(currentSource, artifact))) throw new Error('source changed before saving translation')
    await fs.rename(temporary, artifactPath)
  } finally {
    await fs.rm(temporary, { force: true })
  }
  return { artifactPath, written: artifact.blocks.length }
}

export type PreparedRead =
  | { status: 'ready'; artifact: PreparedTranslation }
  | { status: 'missing' }
  | { status: 'stale' }

export async function readPreparedTranslation(realPath: string, source: string, targetLang: string): Promise<PreparedRead> {
  let input: unknown
  try {
    input = JSON.parse(await fs.readFile(translationFile(realPath, targetLang), 'utf8'))
  } catch (error) {
    return { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'stale' }
  }
  const artifact = await matchPreparedTranslation(source, input)
  return artifact?.targetLang === targetLang ? { status: 'ready', artifact } : { status: 'stale' }
}

/** Discovery is confined to artifacts beside the admitted source, without following redirects. */
export async function listPreparedTranslations(realPath: string, source: string): Promise<PreparedTranslation[]> {
  const directory = path.dirname(translationFile(realPath, 'en'))
  try {
    if (await fs.realpath(directory) !== directory) return []
    const prefix = `${path.basename(realPath)}.`
    const files = (await fs.readdir(directory)).sort()
    const artifacts: PreparedTranslation[] = []
    let bytes = 0
    for (const name of files) {
      if (!name.startsWith(prefix) || !name.endsWith('.json')) continue
      const language = name.slice(prefix.length, -5)
      if (!validLanguageCode(language)) continue
      try {
        const file = path.join(directory, name)
        const metadata = await fs.lstat(file)
        if (!metadata.isFile() || metadata.size > 16 * 1024 * 1024 || await fs.realpath(file) !== file) continue
        bytes += metadata.size
        if (bytes > 32 * 1024 * 1024 || artifacts.length === 64) break
        const result = await readPreparedTranslation(realPath, source, language)
        if (result.status === 'ready') artifacts.push(result.artifact)
      } catch { /* One unreadable artifact must not hide other languages. */ }
    }
    return artifacts
  } catch { return [] }
}
