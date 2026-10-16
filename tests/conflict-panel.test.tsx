// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HostError, installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { ConflictPanel } from '../ui/app/ConflictPanel'
import { Notifications } from '../ui/app/Notifications'
import { createDocStore } from '../ui/documents/store'

const getFile = vi.fn()
const putFile = vi.fn()
const saveCopy = vi.fn()
vi.mock('../ui/i18n', () => ({ useT: () => (key: string) => key }))
const file = (content: string, version: string) => ({ content, version, mtimeMs: 1 })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
beforeEach(() => {
  installHost(fakeHost({ getFile, putFile, saveCopy,
    getSession: async (id) => ({ sessionId: id, displayName: id, path: id, mtimeMs: 1 }) }))
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  getFile.mockReset().mockResolvedValue(file('one\nmiddle\nlast\n', 'v1'))
  putFile.mockReset().mockResolvedValue({ mtimeMs: 2, version: 'v3' })
  saveCopy.mockReset().mockResolvedValue(null)
})
afterEach(() => { installHost(null); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function conflict() {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('ONE\nmiddle\nlast\n')
  getFile.mockResolvedValue(file('one\nmiddle\nLAST\n', 'v2'))
  store.getState().notifyDiskChange(1)
  await vi.advanceTimersByTimeAsync(0)
  return store
}

it('saves a clean merge immediately against the freshly read version and retains undo', async () => {
  const store = await conflict()
  getFile.mockResolvedValue(file('one\r\nmiddle\r\nLAST\r\n', 'fresh'))
  expect(await store.getState().tryMerge()).toBe(true)
  expect(putFile).toHaveBeenCalledWith('A', 'ONE\r\nmiddle\r\nLAST\r\n', 'fresh')
  expect(store.getState()).toMatchObject({ source: 'ONE\nmiddle\nLAST\n', conflict: false, version: 'v3' })
  store.getState().undo()
  expect(store.getState().source).toBe('ONE\nmiddle\nlast\n')
})

it('writes nothing for overlap and retains local text', async () => {
  const store = await conflict()
  getFile.mockResolvedValue(file('competing\nmiddle\nlast\n', 'v4'))
  expect(await store.getState().tryMerge()).toBe(false)
  expect(store.getState().recoveryError).toBe('overlap')
  expect(store.getState().source).toBe('ONE\nmiddle\nlast\n')
  expect(putFile).not.toHaveBeenCalled()
})

it('rejects every editing entry point and autosave while conflict is retained', async () => {
  const store = await conflict()
  const source = store.getState().source
  store.getState().setSource('changed')
  store.getState().setSourceFromEditor('changed')
  store.getState().applyEdits([{ from: 0, to: 1, insert: 'changed' }])
  store.getState().undo()
  await vi.advanceTimersByTimeAsync(1000)
  expect(store.getState().source).toBe(source)
  expect(putFile).not.toHaveBeenCalled()
  expect(await store.getState().prepareToClose()).toBe(false)
  const release = vi.fn()
  expect(await store.getState().closeDocument('A', release)).toBe(false)
  expect(release).not.toHaveBeenCalled()
})

it('preserves local text after missing reads and uncertain or rejected writes', async () => {
  const store = await conflict()
  getFile.mockRejectedValueOnce(new HostError('missing', 'missing'))
  expect(await store.getState().tryMerge()).toBe(false)
  expect(store.getState().recoveryError).toBe('read')
  expect(putFile).not.toHaveBeenCalled()
  putFile.mockRejectedValueOnce(new HostError('conflict', 'changed'))
  expect(await store.getState().tryMerge()).toBe(false)
  expect(store.getState().source).toBe('ONE\nmiddle\nlast\n')
  expect(store.getState().conflict).toBe(true)
  expect(await store.getState().tryMerge()).toBe(true)
})

it('adopts fresh incoming content only after the operation and makes discard undoable', async () => {
  const store = await conflict()
  expect(await store.getState().useConflictDisk()).toBe(true)
  expect(store.getState().source).toBe('one\nmiddle\nLAST\n')
  expect(putFile).not.toHaveBeenCalled()
  store.getState().undo()
  expect(store.getState().source).toBe('ONE\nmiddle\nlast\n')
})

it.each(['merge', 'incoming'])('rejects a newer invalidation during a %s read', async (action) => {
  const store = await conflict()
  const read = deferred<ReturnType<typeof file>>()
  getFile.mockReturnValueOnce(read.promise)
  const result = action === 'merge' ? store.getState().tryMerge() : store.getState().useConflictDisk()
  store.getState().notifyDiskChange(3)
  read.resolve(file('one\nmiddle\nLAST\n', 'v2'))
  expect(await result).toBe(false)
  expect(putFile).not.toHaveBeenCalled()
  expect(store.getState().source).toBe('ONE\nmiddle\nlast\n')
})

it('does not apply a background merge to another document, and revalidates after write invalidations', async () => {
  const store = await conflict()
  const write = deferred<{ mtimeMs: number; version: string }>()
  putFile.mockReturnValueOnce(write.promise)
  const merging = store.getState().tryMerge()
  await vi.advanceTimersByTimeAsync(0)
  store.getState().notifyDiskChange(2)
  getFile.mockResolvedValue(file('B', 'B1'))
  await store.getState().load('B')
  getFile.mockResolvedValue(file('ONE\nmiddle\nnew disk\n', 'v4'))
  write.resolve({ mtimeMs: 2, version: 'v3' })
  expect(await merging).toBe(true)
  expect(store.getState().source).toBe('B')
  await store.getState().load('A')
  expect(store.getState().source).toBe('ONE\nmiddle\nnew disk\n')
})

it('retains dismissal across invalidations and navigation without hiding file attention state', async () => {
  const store = await conflict()
  store.getState().closeConflict()
  store.getState().notifyDiskChange(2)
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getState().conflictDismissed).toBe(true)
  getFile.mockResolvedValue(file('B', 'B1'))
  await store.getState().load('B')
  expect(store.getState().needsAttention('A')).toBe(true)
  store.getState().setSource('B edited')
  expect(store.getState().source).toBe('B edited')
  getFile.mockResolvedValue(file('one\nmiddle\nLAST\n', 'v2'))
  await store.getState().load('A')
  expect(store.getState().conflictDismissed).toBe(true)
  await store.getState().openConflict()
  expect(store.getState().conflictDismissed).toBe(false)
})

it('retains the whole local buffer on save-copy cancellation or failure', async () => {
  const store = await conflict()
  expect(await store.getState().saveCopy()).toBeNull()
  saveCopy.mockRejectedValueOnce(new Error('existing destination'))
  expect(await store.getState().saveCopy()).toBeNull()
  expect(store.getState()).toMatchObject({ conflict: true, source: 'ONE\nmiddle\nlast\n', recoveryError: 'copy' })
  expect(putFile).not.toHaveBeenCalled()
})

it('switches to the admitted copy only after success, releasing the original buffer', async () => {
  const store = await conflict()
  const saving = deferred<unknown>()
  saveCopy.mockReturnValueOnce(saving.promise)
  const operation = store.getState().saveCopy()
  expect(await store.getState().prepareToClose()).toBe(false)
  expect(store.getState().hasDocument('A')).toBe(true)
  getFile.mockResolvedValue(file('ONE\nmiddle\nlast\n', 'copy-v1'))
  saving.resolve({ meta: { sessionId: 'copy', path: 'copy.md', displayName: 'copy.md', mtimeMs: 1 },
    file: file('ONE\nmiddle\nlast\n', 'copy-v1') })
  expect(await operation).toBe('copy')
  expect(store.getState()).toMatchObject({ sessionId: 'copy', conflict: false, source: 'ONE\nmiddle\nlast\n' })
  expect(store.getState().hasDocument('A')).toBe(false)
  expect(store.getState().hasPendingWrites()).toBe(false)
})

it('shows dismissible corner recovery, requires discard confirmation, and has no comparison editor', async () => {
  const store = await conflict()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const button = (key: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === key)!
  try {
    await act(async () => root.render(<Notifications><ConflictPanel store={store} /></Notifications>))
    expect(host.querySelector('.notification-stack .notification')).not.toBeNull()
    expect(host.querySelector('textarea')).toBeNull()
    await act(async () => button('conflictUseDisk').click())
    expect(store.getState().conflict).toBe(true)
    expect(host.textContent).toContain('conflictDiscard')
    await act(async () => button('cancel').click())
    await act(async () => (host.querySelector('[aria-label="dismiss"]') as HTMLButtonElement).click())
    expect(host.textContent).toContain('needsAttention')
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click())
    await act(async () => button('conflictTryMerge').click())
    expect(host.querySelector('.notification')).toBeNull()
    expect(putFile).toHaveBeenCalledWith('A', 'ONE\nmiddle\nLAST\n', 'v2')
  } finally { act(() => root.unmount()); host.remove() }
})

it('does not cancel navigation already in flight when a saved copy completes', async () => {
  const store = await conflict()
  const saving = deferred<unknown>()
  saveCopy.mockReturnValueOnce(saving.promise)
  const operation = store.getState().saveCopy()
  const reading = deferred<ReturnType<typeof file>>()
  getFile.mockReturnValueOnce(reading.promise)
  const navigation = store.getState().load('B')
  saving.resolve({ meta: { sessionId: 'copy', path: 'copy.md', displayName: 'copy.md', mtimeMs: 1 },
    file: file('ONE\nmiddle\nlast\n', 'copy-v1') })
  expect(await operation).toBe('copy')
  reading.resolve(file('B contents', 'B1'))
  await navigation
  expect(store.getState()).toMatchObject({ sessionId: 'B', source: 'B contents' })
  expect(store.getState().hasDocument('copy')).toBe(true)
})
