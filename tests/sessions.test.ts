import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionRegistry } from '../src/server/sessions'
import { planTranslation, publishTranslation, readPreparedTranslation } from '../src/server/translate/prepared'

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

it('opening a session cannot remove a directory being created for a translation artifact', async () => {
  const file = path.join(root, 'plan.md')
  await fs.writeFile(file, 'Hello')
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
  const plan = await planTranslation(file, 'Hello', 'en', 'zh-CN')
  const artifact = { version: 1, sourceHash: plan.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: plan.blocks.filter((b) => b.translatable).map((b) => ({ id: b.id, text: '译文' })) }
  await publishTranslation(file, 'Hello', 'en', 'zh-CN', artifact)
  expect(await readPreparedTranslation(file, 'Hello', 'zh-CN')).toEqual({ status: 'ready', artifact })
})
