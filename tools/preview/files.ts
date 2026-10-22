import { isUtf8 } from 'node:buffer'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import type { FileResponse } from '../../ui/app/hostTypes'
interface FileTarget { path: string }

function identity(st: BigIntStats): string {
  return [st.dev, st.ino, st.size, st.mtimeNs, st.ctimeNs].join(':')
}

async function snapshot(handle: FileHandle, filePath: string): Promise<FileResponse> {
  const before = await handle.stat({ bigint: true })
  if (!before.isFile()) throw new Error('not a regular file')
  const bytes = await handle.readFile()
  const after = await handle.stat({ bigint: true })
  const current = await fs.stat(filePath, { bigint: true })
  if (identity(before) !== identity(after) || identity(after) !== identity(current)) {
    throw new Error('file changed during read')
  }
  const hash = crypto.createHash('sha256').update(bytes).digest('hex')
  return { content: bytes.toString('utf8'), mtimeMs: Number(after.mtimeNs) / 1e6, version: `${identity(after)}:${hash}`,
    lossy: !isUtf8(bytes) }
}

/** Reads through one descriptor and rejects a changed or replaced file. */
export async function readSessionFile(filePath: string): Promise<FileResponse> {
  const handle = await fs.open(filePath, 'r')
  try {
    return await snapshot(handle, filePath)
  } finally {
    await handle.close()
  }
}

type WriteResult =
  | { ok: true; mtimeMs: number; version: string }
  | { ok: false; currentMtimeMs: number | null }
  | { ok: false; error: 'not_utf8' }

const pendingWrites = new Map<string, Promise<unknown>>()

/** Serializes this process's writes; unrelated filesystem writers do not share this lock. */
export async function writeSessionFile(session: FileTarget, content: string, baseVersion: string): Promise<WriteResult> {
  const key = await fs.realpath(session.path).catch(() => session.path)
  const previous = pendingWrites.get(key) ?? Promise.resolve()
  const write = previous.catch(() => {}).then(async (): Promise<WriteResult> => {
    let handle: FileHandle
    try {
      handle = await fs.open(session.path, 'r+')
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return { ok: false, currentMtimeMs: null }
      }
      throw error
    }
    try {
      let base: FileResponse
      try {
        base = await snapshot(handle, session.path)
      } catch {
        return { ok: false, currentMtimeMs: null }
      }
      if (base.version !== baseVersion) return { ok: false, currentMtimeMs: base.mtimeMs }
      if (content === base.content) return { ok: true, mtimeMs: base.mtimeMs, version: base.version }
      // The UI edits lossy-decoded text, so changed content would also rewrite every invalid
      // sequence the person never touched.
      if (base.lossy) return { ok: false, error: 'not_utf8' }
      // Writing the opened inode preserves permissions and symlinks. A foreign writer can
      // still intervene after the checked snapshot; this is not an atomic filesystem CAS.
      const bytes = Buffer.from(content, 'utf8')
      let offset = 0
      while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset)
        if (bytesWritten === 0) throw new Error('file write made no progress')
        offset += bytesWritten
      }
      await handle.truncate(bytes.length)
      const written = await readSessionFile(session.path)
      const inode = await handle.stat({ bigint: true })
      const current = await fs.stat(session.path, { bigint: true })
      if (inode.dev !== current.dev || inode.ino !== current.ino || written.content !== content) return { ok: false, currentMtimeMs: written.mtimeMs }
      return { ok: true, mtimeMs: written.mtimeMs, version: written.version }
    } finally {
      await handle.close()
    }
  })
  pendingWrites.set(key, write)
  try {
    return await write
  } finally {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key)
  }
}
