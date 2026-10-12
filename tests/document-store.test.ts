import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDocStore } from '../src/ui/app/store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response
let writes: Array<{ id: string; content: string; baseVersion: string; pending: ReturnType<typeof deferred<Response>> }>
let disks: Map<string, unknown>
let reads: Map<string, ReturnType<typeof deferred<Response>>>
beforeEach(() => {
  vi.useFakeTimers()
  writes = []
  disks = new Map()
  reads = new Map()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const id = url.split('/')[3]!
    if (init?.method === 'PUT') {
      const pending = deferred<Response>()
      writes.push({ id, ...JSON.parse(init.body as string), pending })
      return pending.promise.then(async (res) => {
        if (res.ok) disks.set(id, { ...await res.json(), content: JSON.parse(init.body as string).content })
        return res
      })
    }
    if (url.endsWith('/file')) return reads.get(id)?.promise ?? response(disks.get(id) ?? { content: id, mtimeMs: 1, version: `${id}-1` })
    return response({ sessionId: id, displayName: id, path: id })
  }))
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('saves the departing buffer and keeps undo isolated across documents', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('A edit')
  await store.getState().load('B')
  store.getState().undo()
  expect(store.getState().source).toBe('B')
  await vi.advanceTimersByTimeAsync(600)
  expect(writes.map((w) => [w.id, w.content])).toEqual([['A', 'A edit']])
  writes[0]!.pending.resolve(response({ mtimeMs: 2, version: 'A-2' }))
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getState().savedSource).toBe('B')
  await store.getState().load('A')
  expect(store.getState().source).toBe('A edit')
  expect(store.getState().savedSource).toBe('A edit')
  store.getState().undo()
  expect(store.getState().source).toBe('A')
})

it('ignores reversed load completion', async () => {
  const tab = { title: '' }
  vi.stubGlobal('document', tab)
  const store = createDocStore()
  const a = deferred<Response>()
  const b = deferred<Response>()
  reads.set('A', a); reads.set('B', b)
  const first = store.getState().load('A')
  const second = store.getState().load('B')
  b.resolve(response({ content: 'B', mtimeMs: 1, version: 'B-1' }))
  await second
  expect(tab.title).toBe('B — mastermind')
  a.resolve(response({ content: 'A', mtimeMs: 1, version: 'A-1' }))
  await first
  expect(store.getState().sessionId).toBe('B')
  expect(store.getState().source).toBe('B')
  expect(tab.title).toBe('B — mastermind')
})

it('flushes an edit made during a slow save without another keystroke', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSourceFromEditor('first')
  await vi.advanceTimersByTimeAsync(600)
  store.getState().setSourceFromEditor('second')
  await vi.advanceTimersByTimeAsync(600)
  expect(writes).toHaveLength(1)
  writes[0]!.pending.resolve(response({ mtimeMs: 2, version: 'A-2' }))
  await vi.advanceTimersByTimeAsync(600)
  expect(writes).toHaveLength(2)
  expect(writes[1]!.content).toBe('second')
  expect(writes[1]!.baseVersion).toBe('A-2')
})

it('retains failed writes and failed navigation for recovery', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('local')
  const b = deferred<Response>(); reads.set('B', b)
  const load = store.getState().load('B')
  b.resolve(response({ error: 'gone' }, 404))
  await load
  expect(store.getState().sessionId).toBe('A')
  expect(store.getState().source).toBe('local')
  await vi.advanceTimersByTimeAsync(600)
  writes[0]!.pending.resolve(response({ error: 'changed' }, 409))
  await vi.advanceTimersByTimeAsync(0)
  await store.getState().load('C')
  await store.getState().load('A')
  expect(store.getState().source).toBe('local')
  expect(store.getState().savedSource).toBe('A')
  expect(store.getState().conflict).toBe(true)
})

it('does not run a departing editor flusher against another document', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  const flush = vi.fn(() => store.getState().setSourceFromEditor('A flushed'))
  store.getState().registerFlusher(flush)
  const stale = store.getState().flushEditor!
  await store.getState().load('B')
  expect(flush).toHaveBeenCalledTimes(1)
  stale()
  expect(flush).toHaveBeenCalledTimes(1)
  expect(store.getState().source).toBe('B')
})

it('reloads clean external changes and retains all versions when dirty', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  const disk = deferred<Response>(); reads.set('A', disk)
  store.getState().notifyDiskChange(2)
  disk.resolve(response({ content: 'external', mtimeMs: 2, version: 'A-2' }))
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getState().source).toBe('external')
  store.getState().setSource('local')
  const newer = deferred<Response>(); reads.set('A', newer)
  store.getState().notifyDiskChange(3)
  newer.resolve(response({ content: 'disk', mtimeMs: 3, version: 'A-3' }))
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getState().source).toBe('local')
  expect(store.getState().savedSource).toBe('external')
  expect(store.getState().diskChange?.content).toBe('disk')
  expect(store.getState().conflict).toBe(true)
  await vi.advanceTimersByTimeAsync(600)
  expect(writes).toHaveLength(0)
})

it('does not let a delayed reload replace edits made while reading disk', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  const disk = deferred<Response>(); reads.set('A', disk)
  const reload = store.getState().reloadFromDisk()
  store.getState().setSource('local')
  disk.resolve(response({ content: 'disk', mtimeMs: 2, version: 'A-2' }))
  await reload
  expect(store.getState().source).toBe('local')
})

it('revalidates retained documents and captures inactive external changes', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  await store.getState().load('B')
  disks.set('A', { content: 'external A', mtimeMs: 2, version: 'A-2' })
  await store.getState().load('A')
  expect(store.getState().source).toBe('external A')
  store.getState().setSource('local A')
  await store.getState().load('B')
  disks.set('A', { content: 'new disk A', mtimeMs: 3, version: 'A-3' })
  await store.getState().load('A')
  expect(store.getState().source).toBe('local A')
  expect(store.getState().savedSource).toBe('external A')
  expect(store.getState().diskChange?.content).toBe('new disk A')
})

it('ignores reversed disk reads and reconciles changes received during a save', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  const first = deferred<Response>(); reads.set('A', first)
  store.getState().notifyDiskChange(2)
  const second = deferred<Response>(); reads.set('A', second)
  store.getState().notifyDiskChange(3)
  second.resolve(response({ content: 'newest', mtimeMs: 3, version: 'A-3' }))
  await vi.advanceTimersByTimeAsync(0)
  first.resolve(response({ content: 'stale', mtimeMs: 2, version: 'A-2' }))
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getState().source).toBe('newest')
  store.getState().setSource('local')
  await vi.advanceTimersByTimeAsync(600)
  store.getState().notifyDiskChange(5)
  const disk = deferred<Response>(); reads.set('A', disk)
  writes[0]!.pending.resolve(response({ mtimeMs: 4, version: 'A-4' }))
  await vi.advanceTimersByTimeAsync(0)
  disk.resolve(response({ content: 'external after save', mtimeMs: 5, version: 'A-5' }))
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getState().source).toBe('external after save')
})

it('tracks and flushes retained dirty documents for browser lifecycle checks', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  expect(store.getState().hasPendingWrites()).toBe(false)
  store.getState().setSource('local')
  await store.getState().load('B')
  expect(store.getState().hasPendingWrites()).toBe(true)
  const flush = store.getState().flushAll()
  expect(writes).toHaveLength(1)
  writes[0]!.pending.resolve(response({ mtimeMs: 2, version: 'A-2' }))
  await flush
  expect(store.getState().hasPendingWrites()).toBe(false)
})

it('invalidates an external read overtaken by a successful write', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  const stale = deferred<Response>(); reads.set('A', stale)
  store.getState().notifyDiskChange(2)
  store.getState().setSource('local')
  const save = store.getState().autosave()
  await vi.advanceTimersByTimeAsync(0)
  writes[0]!.pending.resolve(response({ mtimeMs: 3, version: 'A-3' }))
  await save
  stale.resolve(response({ content: 'external', mtimeMs: 2, version: 'A-2' }))
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getState().source).toBe('local')
  expect(store.getState().version).toBe('A-3')
})

it('cancels browser unload when an inactive document has pending edits', async () => {
  const { registerDocumentLifecycle } = await import('../src/ui/app/documentLifecycle')
  const windowTarget = new EventTarget()
  const documentTarget = new EventTarget()
  vi.stubGlobal('window', windowTarget)
  vi.stubGlobal('document', documentTarget)
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('local')
  await store.getState().load('B')
  const teardown = registerDocumentLifecycle(store)
  const event = new Event('beforeunload', { cancelable: true })
  windowTarget.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(writes).toHaveLength(1)
  writes[0]!.pending.resolve(response({ mtimeMs: 2, version: 'A-2' }))
  await vi.advanceTimersByTimeAsync(0)
  const clean = new Event('beforeunload', { cancelable: true })
  windowTarget.dispatchEvent(clean)
  expect(clean.defaultPrevented).toBe(false)
  teardown()
})

it('native quit waits for an in-flight save, then saves edits made behind it', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('first')
  const saving = store.getState().autosave()
  store.getState().setSource('latest')
  let settled = false
  const closing = store.getState().prepareToClose().then((ready) => { settled = true; return ready })
  await Promise.resolve()
  expect(settled).toBe(false)
  writes[0]!.pending.resolve(response({ mtimeMs: 2, version: 'A-2' }))
  await saving
  await vi.advanceTimersByTimeAsync(0)
  expect(writes[1]).toMatchObject({ content: 'latest', baseVersion: 'A-2' })
  expect(settled).toBe(false)
  writes[1]!.pending.resolve(response({ mtimeMs: 3, version: 'A-3' }))
  expect(await closing).toBe(true)
  expect(store.getState().hasPendingWrites()).toBe(false)
})

it('native quit retains failed saves and edited comparison results', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('local')
  const closing = store.getState().prepareToClose()
  await vi.advanceTimersByTimeAsync(0)
  writes[0]!.pending.resolve(response({ error: 'unavailable' }, 500))
  expect(await closing).toBe(false)
  expect(store.getState().source).toBe('local')
  await store.getState().openConflict()
  store.getState().setConflictResult('unapplied result')
  expect(await store.getState().prepareToClose()).toBe(false)
  expect(store.getState().conflictDraft?.result).toBe('unapplied result')
})
