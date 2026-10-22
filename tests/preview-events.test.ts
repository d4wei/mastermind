import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPreview } from '../tools/preview/app'

const reads = vi.hoisted(() => ({ failures: 0 }))
vi.mock('../tools/preview/files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tools/preview/files')>()
  return { ...actual, async readSessionFile(filePath: string) {
    if (reads.failures > 0) {
      reads.failures--
      throw new Error('file changed during read')
    }
    return actual.readSessionFile(filePath)
  } }
})

const POLL_MS = 10
let dir: string
let file: string
let stop: (() => void) | undefined
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-preview-events-'))
  file = path.join(dir, 'doc.md')
  await fs.writeFile(file, 'original\n')
})
afterEach(async () => {
  stop?.()
  reads.failures = 0
  await fs.rm(dir, { recursive: true, force: true })
})

async function subscribe(beforeOpening?: () => Promise<void>): Promise<() => string[]> {
  const app = await createPreview(file, path.resolve('themes'), { pollMs: POLL_MS })
  await beforeOpening?.()
  const response = await app.request('/api/sessions/preview/events', { headers: { host: 'localhost' } })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  stop = () => { void reader.cancel() }
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      text += decoder.decode(value, { stream: true })
    }
  })().catch(() => {})
  return () => [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1]!)
}

it('skips a read that races a save instead of reporting the file deleted', async () => {
  reads.failures = 5
  const events = await subscribe()
  await vi.waitFor(() => expect(reads.failures).toBe(0))
  await sleep(POLL_MS * 5)
  expect(events()).toEqual([])
})

it('reports a missing file once per deletion and a recreated file as changed', async () => {
  const events = await subscribe()
  await sleep(POLL_MS * 3)
  await fs.unlink(file)
  await vi.waitFor(() => expect(events()).toEqual(['file-deleted']))
  await sleep(POLL_MS * 5)
  expect(events()).toEqual(['file-deleted'])
  await fs.writeFile(file, 'restored\n')
  await vi.waitFor(() => expect(events()).toEqual(['file-deleted', 'file-changed']))
  await fs.unlink(file)
  await vi.waitFor(() => expect(events()).toEqual(['file-deleted', 'file-changed', 'file-deleted']))
})

it('reports a file recreated after the stream opened while it was missing', async () => {
  const events = await subscribe(() => fs.unlink(file))
  await vi.waitFor(() => expect(events()).toEqual(['file-deleted']))
  await fs.writeFile(file, 'restored\n')
  await vi.waitFor(() => expect(events()).toEqual(['file-deleted', 'file-changed']))
})

it('reports a file replaced by a directory as missing', async () => {
  const events = await subscribe()
  await sleep(POLL_MS * 3)
  await fs.unlink(file)
  await fs.mkdir(file)
  await vi.waitFor(() => expect(events()).toEqual(['file-deleted']))
  await sleep(POLL_MS * 5)
  expect(events()).toEqual(['file-deleted'])
})
