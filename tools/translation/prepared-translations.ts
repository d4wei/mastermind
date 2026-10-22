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

const ARTIFACT_BYTES = 16 * 1024 * 1024
const DISCOVERY_BYTES = 32 * 1024 * 1024
const DISCOVERY_COUNT = 64

/**
 * The artifact directory beside the source, or null when a segment of `.mastermind/translations` is
 * a link. Each segment is checked with lstat before the next is entered, so a link is never followed,
 * and with `create` a missing segment is made one level at a time only after its parent passed.
 */
async function artifactDirectory(realPath: string, create = false): Promise<string | null> {
  let directory = await fs.realpath(path.dirname(realPath))
  for (const segment of ['.mastermind', 'translations']) {
    directory = path.join(directory, segment)
    if (create) await fs.mkdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
    const stats = await fs.lstat(directory)
    if (stats.isSymbolicLink()) return null
    if (!stats.isDirectory()) throw Object.assign(new Error(`${directory} is not a directory`), { code: 'ENOTDIR' })
  }
  return directory
}

/**
 * Reads an artifact only when it is a regular file within the size cap. Links, FIFOs, and devices
 * are refused before opening; the descriptor is opened without following links or blocking and
 * must still be the inode that was checked.
 */
async function readArtifactBytes(file: string): Promise<Buffer | null> {
  const checked = await fs.lstat(file)
  if (!checked.isFile() || checked.size > ARTIFACT_BYTES) return null
  const { O_RDONLY, O_NOFOLLOW = 0, O_NONBLOCK = 0 } = fs.constants
  const handle = await fs.open(file, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== checked.dev || opened.ino !== checked.ino || opened.size > ARTIFACT_BYTES) return null
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

export async function savePreparedTranslation(realPath: string, source: string, sourceLang: string,
  targetLang: string, input: unknown): Promise<{ artifactPath: string; written: number }> {
  if (!validLanguageCode(sourceLang) || !validLanguageCode(targetLang)) throw new Error('explicit language codes required')
  const artifact = await matchPreparedTranslation(source, input)
  if (!artifact || artifact.sourceLang !== sourceLang || artifact.targetLang !== targetLang) {
    throw new Error('translation must match the current source, languages, and complete block structure')
  }
  const artifactPath = translationFile(realPath, targetLang)
  if (!(await artifactDirectory(realPath, true))) throw new Error("translation directory resolves outside the document's folder")
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

type PreparedRead =
  | { status: 'ready'; artifact: PreparedTranslation }
  | { status: 'missing' }
  | { status: 'stale' }

async function matchArtifact(bytes: Buffer, source: string, targetLang: string): Promise<PreparedRead> {
  let input: unknown
  try { input = JSON.parse(bytes.toString('utf8')) } catch { return { status: 'stale' } }
  const artifact = await matchPreparedTranslation(source, input)
  return artifact?.targetLang === targetLang ? { status: 'ready', artifact } : { status: 'stale' }
}

/** A redirected directory or an artifact that is not a bounded regular file reads as stale. */
export async function readPreparedTranslation(realPath: string, source: string, targetLang: string): Promise<PreparedRead> {
  const name = path.basename(translationFile(realPath, targetLang))
  let bytes: Buffer | null
  try {
    const directory = await artifactDirectory(realPath)
    bytes = directory ? await readArtifactBytes(path.join(directory, name)) : null
  } catch (error) {
    return { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'stale' }
  }
  return bytes ? matchArtifact(bytes, source, targetLang) : { status: 'stale' }
}

/** Discovery reads through the same guards as a single read, within a total byte and count budget. */
export async function listPreparedTranslations(realPath: string, source: string): Promise<PreparedTranslation[]> {
  try {
    const directory = await artifactDirectory(realPath)
    if (!directory) return []
    const prefix = `${path.basename(realPath)}.`
    const files = (await fs.readdir(directory)).sort()
    const artifacts: PreparedTranslation[] = []
    let bytes = 0
    for (const name of files) {
      if (!name.startsWith(prefix) || !name.endsWith('.json')) continue
      const language = name.slice(prefix.length, -5)
      if (!validLanguageCode(language)) continue
      if (artifacts.length === DISCOVERY_COUNT) break
      try {
        const content = await readArtifactBytes(path.join(directory, name))
        if (!content) continue
        bytes += content.length
        if (bytes > DISCOVERY_BYTES) break
        const result = await matchArtifact(content, source, language)
        if (result.status === 'ready') artifacts.push(result.artifact)
      } catch { /* One unreadable artifact must not hide other languages. */ }
    }
    return artifacts
  } catch { return [] }
}
