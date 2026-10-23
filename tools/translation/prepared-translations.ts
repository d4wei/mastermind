import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { matchPreparedTranslation, prepareTranslation } from '../../document/translation'

export function validLanguageCode(code: string): boolean {
  return code.length <= 64 && /^[A-Za-z][A-Za-z0-9_-]*$/.test(code)
}

function translationDirectory(realPath: string): string {
  return path.join(path.dirname(realPath), '.mastermind', 'translations')
}

export function translationFile(realPath: string, targetLang: string): string {
  if (!validLanguageCode(targetLang)) throw new Error('invalid target language code')
  return path.join(translationDirectory(realPath), `${path.basename(realPath)}.${targetLang}.json`)
}

export async function planTranslation(realPath: string, source: string, sourceLang: string, targetLang: string) {
  if (!validLanguageCode(sourceLang) || !validLanguageCode(targetLang)) throw new Error('explicit language codes required')
  return { version: 1 as const, ...(await prepareTranslation(source)), sourceLang, targetLang,
    artifactPath: translationFile(realPath, targetLang) }
}

/**
 * The artifact directory beside the source, or null when a segment of `.mastermind/translations` is
 * a link. Each segment is checked with lstat before the next is entered, so a link is never followed,
 * and a missing segment is made one level at a time only after its parent passed. Each segment's
 * on-disk name must match exactly, so a case variant on a case-insensitive volume is refused as the
 * native host refuses it.
 */
async function artifactDirectory(realPath: string): Promise<string | null> {
  let directory = await fs.realpath(path.dirname(realPath))
  for (const segment of ['.mastermind', 'translations']) {
    const parent = directory
    directory = path.join(parent, segment)
    await fs.mkdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
    const stats = await fs.lstat(directory)
    if (stats.isSymbolicLink()) return null
    if (!stats.isDirectory()) throw Object.assign(new Error(`${directory} is not a directory`), { code: 'ENOTDIR' })
    if (!(await fs.readdir(parent)).includes(segment)) {
      throw Object.assign(new Error(`translation directory must be named exactly ${translationDirectory(realPath)}`), { code: 'EINVAL' })
    }
  }
  return directory
}

export async function savePreparedTranslation(realPath: string, source: string, sourceLang: string,
  targetLang: string, input: unknown): Promise<{ artifactPath: string; written: number }> {
  if (!validLanguageCode(sourceLang) || !validLanguageCode(targetLang)) throw new Error('explicit language codes required')
  const artifact = await matchPreparedTranslation(source, input)
  if (!artifact || artifact.sourceLang !== sourceLang || artifact.targetLang !== targetLang) {
    throw new Error('translation must match the current source, languages, and complete block structure')
  }
  const artifactPath = translationFile(realPath, targetLang)
  if (!(await artifactDirectory(realPath))) {
    throw new Error(`translation directory must not be a symbolic link and must be named exactly ${translationDirectory(realPath)}`)
  }
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
