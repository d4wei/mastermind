import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionRegistry } from '../src/server/sessions'
import { loadCache, saveCache } from '../src/server/translate/cache'

let root: string
let sessions: SessionRegistry

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-sessions-'))
  sessions = new SessionRegistry({ neverOpenedMs: 50_000 })
})

afterEach(async () => {
  sessions.closeAll('shutdown')
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

it('opening a session leaves existing historical files untouched', async () => {
  const file = path.join(root, 'plan.md')
  const history = path.join(root, '.mastermind', 'history', 'plan.md')
  await fs.mkdir(history, { recursive: true })
  const snapshot = path.join(history, 'snapshot.md')
  const bytes = Buffer.from('Previous review\r\n{>>历史记录<<}')
  await fs.writeFile(snapshot, bytes)
  const remove = vi.spyOn(fs, 'rm')

  sessions.open(file)
  await Promise.all(remove.mock.results.map((result) => result.value))

  expect(await fs.readFile(snapshot)).toEqual(bytes)
  expect(remove).not.toHaveBeenCalled()
})

it('opening a session cannot remove a directory being created for the translation cache', async () => {
  const file = path.join(root, 'plan.md')
  const stateDir = path.join(root, '.mastermind')
  const originalMkdir = fs.mkdir.bind(fs)
  const originalRmdir = fs.rmdir.bind(fs)
  let releaseParentCreated!: () => void
  const parentCreated = new Promise<void>((resolve) => { releaseParentCreated = resolve })
  let releasePruning!: () => void
  const pruningFinished = new Promise<void>((resolve) => { releasePruning = resolve })
  const remove = vi.spyOn(fs, 'rm')
  vi.spyOn(fs, 'rmdir').mockImplementation(async (dir) => {
    if (dir === stateDir) {
      await parentCreated
      try { await originalRmdir(dir) } finally { releasePruning() }
      return
    }
    return originalRmdir(dir)
  })
  vi.spyOn(fs, 'mkdir').mockImplementation(async (dir, options) => {
    if (dir === path.join(stateDir, 'translations')) {
      // Expose the gap between recursive mkdir creating its parent and child.
      await originalMkdir(stateDir, { recursive: true })
      releaseParentCreated()
      if (remove.mock.calls.length > 0) await pruningFinished
      await originalMkdir(dir)
      return undefined
    }
    return originalMkdir(dir, options as { recursive: true })
  })

  sessions.open(file)
  await saveCache(file, 'zh-CN', { h1: '译文' })

  expect(await loadCache(file, 'zh-CN')).toEqual({ h1: '译文' })
})
