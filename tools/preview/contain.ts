import fs from 'node:fs/promises'
import path from 'node:path'

/** Reject lexical traversal and symlink escapes before reading preview assets. */
export async function resolveWithin(rootReal: string, rel: string): Promise<string | null> {
  if (path.isAbsolute(rel)) return null
  const normalized = path.normalize(rel)
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) return null

  let real: string
  try {
    real = await fs.realpath(path.resolve(rootReal, normalized))
  } catch {
    return null // ENOENT / EACCES / dangling symlink — treat as not found
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null
  return real
}
