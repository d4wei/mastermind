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
    getSession: async (id) => ({ sessionId: id, displayName: id, path: id }) }))
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  getFile.mockReset().mockResolvedValue(file('one\nmiddle\nlast\n', 'v1'))
  putFile.mockReset().mockResolvedValue({ version: 'v3' })
  saveCopy.mockReset().mockResolvedValue(null)
})
afterEach(() => { installHost(null); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function conflict() {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('ONE\nmiddle\nlast\n')
  getFile.mockResolvedValue(file('one\nmiddle\nLAST\n', 'v2'))
  store.getState().notifyDiskChange()
  await vi.advanceTimersByTimeAsync(0)
  return store
}

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

it('adopts fresh incoming content only after the operation and makes discard undoable', async () => {
  const store = await conflict()
  expect(await store.getState().useConflictDisk()).toBe(true)
  expect(store.getState().source).toBe('one\nmiddle\nLAST\n')
  expect(putFile).not.toHaveBeenCalled()
  store.getState().undo()
  expect(store.getState().source).toBe('ONE\nmiddle\nlast\n')
})

it('rejects a newer invalidation during an incoming read', async () => {
  const store = await conflict()
  const read = deferred<ReturnType<typeof file>>()
  getFile.mockReturnValueOnce(read.promise)
  const result = store.getState().useConflictDisk()
  store.getState().notifyDiskChange()
  read.resolve(file('one\nmiddle\nLAST\n', 'v2'))
  expect(await result).toBe(false)
  expect(putFile).not.toHaveBeenCalled()
  expect(store.getState().source).toBe('ONE\nmiddle\nlast\n')
})

it('presents the newer version when an invalidation rejects Use incoming', async () => {
  const store = await conflict()
  const read = deferred<ReturnType<typeof file>>()
  getFile.mockReturnValueOnce(read.promise)
  const result = store.getState().useConflictDisk()
  store.getState().notifyDiskChange()
  getFile.mockResolvedValue(file('newest\n', 'v3'))
  read.resolve(file('one\nmiddle\nLAST\n', 'v2'))
  expect(await result).toBe(false)
  expect(store.getState()).toMatchObject({ recovery: 'changed', saving: false, source: 'ONE\nmiddle\nlast\n' })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Notifications><ConflictPanel store={store} /></Notifications>))
    expect(host.textContent).toContain('conflictNotice')
    expect([...host.querySelectorAll('.conflict-actions button')].map((button) => button.textContent))
      .toEqual(['conflictSaveCopy', 'conflictUseDisk'])
  } finally { act(() => root.unmount()); host.remove() }
  expect(await store.getState().useConflictDisk()).toBe(true)
  expect(store.getState().source).toBe('newest\n')
})

it('retains dismissal across invalidations and navigation without hiding file attention state', async () => {
  const store = await conflict()
  store.getState().closeConflict()
  store.getState().notifyDiskChange()
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
  store.getState().openConflict()
  expect(store.getState().conflictDismissed).toBe(false)
})

it('retains the whole local buffer on save-copy cancellation or failure', async () => {
  const store = await conflict()
  expect(await store.getState().saveCopy()).toBeNull()
  saveCopy.mockRejectedValueOnce(new Error('existing destination'))
  expect(await store.getState().saveCopy()).toBeNull()
  expect(store.getState()).toMatchObject({ recovery: 'changed', source: 'ONE\nmiddle\nlast\n', copyError: true })
  expect(putFile).not.toHaveBeenCalled()
})

it('clears a failed ordinary copy once a later write succeeds', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('edited\n')
  saveCopy.mockRejectedValueOnce(new Error('existing destination'))
  expect(await store.getState().saveCopy()).toBeNull()
  expect(store.getState()).toMatchObject({ recovery: null, copyError: true })
  store.getState().setSource('edited again\n')
  await vi.advanceTimersByTimeAsync(600)
  expect(putFile).toHaveBeenCalledOnce()
  expect(store.getState()).toMatchObject({ savedSource: 'edited again\n', copyError: false })
})

it('switches to the admitted copy only after success, releasing the original buffer', async () => {
  const store = await conflict()
  const saving = deferred<unknown>()
  saveCopy.mockReturnValueOnce(saving.promise)
  const operation = store.getState().saveCopy()
  const closing = store.getState().prepareToClose()
  expect(store.getState().hasDocument('A')).toBe(true)
  getFile.mockResolvedValue(file('ONE\nmiddle\nlast\n', 'copy-v1'))
  saving.resolve({ meta: { sessionId: 'copy', path: 'copy.md', displayName: 'copy.md' },
    file: file('ONE\nmiddle\nlast\n', 'copy-v1') })
  expect(await operation).toBe('copy')
  expect(await closing).toBe(true)
  expect(store.getState()).toMatchObject({ sessionId: 'copy', recovery: null, source: 'ONE\nmiddle\nlast\n' })
  expect(store.getState().hasDocument('A')).toBe(false)
  expect(store.getState().pendingDocuments()).toEqual([])
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
    expect(store.getState().recovery).toBe('changed')
    expect(host.textContent).toContain('conflictDiscard')
    await act(async () => button('cancel').click())
    await act(async () => (host.querySelector('[aria-label="dismiss"]') as HTMLButtonElement).click())
    expect(host.querySelector('[aria-label*="needsAttention"]')).not.toBeNull()
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click())
    await act(async () => button('conflictUseDisk').click())
    await act(async () => button('conflictUseDisk').click())
    expect(host.querySelector('.notification')).toBeNull()
    expect(putFile).not.toHaveBeenCalled()
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
  saving.resolve({ meta: { sessionId: 'copy', path: 'copy.md', displayName: 'copy.md' },
    file: file('ONE\nmiddle\nlast\n', 'copy-v1') })
  expect(await operation).toBe('copy')
  reading.resolve(file('B contents', 'B1'))
  await navigation
  expect(store.getState()).toMatchObject({ sessionId: 'B', source: 'B contents' })
  expect(store.getState().hasDocument('copy')).toBe(true)
})

it('retries a failed write only after reading the acknowledged version', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('local')
  putFile.mockRejectedValueOnce(new HostError('failure', 'permission denied'))
  await store.getState().prepareToClose()
  expect(store.getState()).toMatchObject({ recovery: 'saveFailed' })
  getFile.mockClear(); putFile.mockClear()
  expect(await store.getState().retryRecovery()).toBe(true)
  expect(getFile).toHaveBeenCalledWith('A')
  expect(putFile).toHaveBeenCalledWith('A', 'local', 'v1')
  expect(getFile.mock.invocationCallOrder[0]).toBeLessThan(putFile.mock.invocationCallOrder[0]!)
  expect(store.getState()).toMatchObject({ recovery: null, savedSource: 'local' })
})

it('reconciles a failed write whose complete buffer is already on disk', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('local')
  putFile.mockImplementationOnce(async () => {
    getFile.mockResolvedValue(file('local', 'v2'))
    throw new HostError('failure', 'readback failed')
  })
  await store.getState().prepareToClose()
  expect(store.getState()).toMatchObject({ recovery: null, savedSource: 'local', version: 'v2' })
  expect(store.getState().pendingDocuments()).toEqual([])
  expect(putFile).toHaveBeenCalledOnce()
})

it('keeps Retry available when saving a copy fails after a read failure', async () => {
  const store = await conflict()
  getFile.mockRejectedValue(new HostError('failure', 'permission denied'))
  store.getState().notifyDiskChange()
  await vi.advanceTimersByTimeAsync(0)
  saveCopy.mockRejectedValue(new Error('copy failed'))
  await store.getState().saveCopy()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Notifications><ConflictPanel store={store} /></Notifications>))
    const choices = [...host.querySelectorAll('.conflict-actions button')].map((button) => button.textContent)
    expect(choices).toEqual(['conflictSaveCopy', 'retry'])
    expect(host.textContent).toContain('conflictCopyFailed')
    expect(store.getState().recovery).toBe('readFailed')
  } finally { act(() => root.unmount()); host.remove() }
})

it.each([
  ['changed', 'conflictNotice', 'conflictUseDisk'],
  ['missing', 'conflictMissing', 'retry'],
  ['readFailed', 'conflictReadFailed', 'retry'],
  ['saveFailed', 'conflictSaveFailed', 'retry'],
] as const)('presents %s recovery with its message and choices', async (recovery, message, choice) => {
  const store = await conflict()
  store.setState({ recovery })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Notifications><ConflictPanel store={store} /></Notifications>))
    expect(host.textContent).toContain(message)
    expect([...host.querySelectorAll('.conflict-actions button')].map((button) => button.textContent))
      .toEqual(['conflictSaveCopy', choice])
  } finally { act(() => root.unmount()); host.remove() }
})
