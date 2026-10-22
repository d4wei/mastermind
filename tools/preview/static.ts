import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveWithin } from './contain'

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

// The desktop build copies the themes tree without TypeScript sources or Markdown docs; the preview
// serves the same set.
export const EXCLUDED_THEME_FILES = /\.(?:ts|md)$/i

/**
 * Serve `relPath` from inside `root`, or return null when missing, excluded, or escaping.
 * Hand-rolled (rather than serveStatic middleware) so traversal is contained explicitly.
 */
export async function serveFile(root: string, relPath: string): Promise<Response | null> {
  if (EXCLUDED_THEME_FILES.test(relPath)) return null
  const realRoot = await fs.realpath(root).catch(() => null)
  if (!realRoot) return null
  const abs = await resolveWithin(realRoot, relPath)
  if (!abs || EXCLUDED_THEME_FILES.test(abs)) return null
  let data: Buffer
  try {
    data = await fs.readFile(abs)
  } catch {
    return null
  }
  const headers = {
    'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  }
  return new Response(new Uint8Array(data), { status: 200, headers })
}
