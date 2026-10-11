// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError, getFile, getSession, putFile } from '../src/ui/app/api'
import { ConflictPanel } from '../src/ui/app/ConflictPanel'
import { createDocStore } from '../src/ui/app/store'

vi.mock('../src/ui/app/api', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message) }
  }
  return { ApiError, getFile: vi.fn(), getSession: vi.fn(), putFile: vi.fn(),
    postHandback: vi.fn(), postRename: vi.fn() }
})
vi.mock('../src/ui/i18n', () => ({ useT: () => (key: string) => key }))
const file = (content: string, version: string) => ({ content, version, mtimeMs: 1 })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(getSession).mockReset().mockResolvedValue({ displayName: 'A', path: 'A' } as never)
  vi.mocked(getFile).mockReset().mockResolvedValue(file('base', 'v1'))
  vi.mocked(putFile).mockReset().mockResolvedValue({ mtimeMs: 2, version: 'v3' })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function comparison() {
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('local')
  vi.mocked(getFile).mockResolvedValue(file('disk', 'v2'))
  store.getState().notifyDiskChange(1)
  await vi.advanceTimersByTimeAsync(0)
  await store.getState().openConflict()
  return store
}

it('guards the captured local revision, including an edit reverted to the same text', async () => {
  const store = await comparison()
  store.getState().setConflictResult('merged')
  store.getState().setSourceFromEditor('changed')
  store.getState().setSourceFromEditor('local')
  expect(await store.getState().saveConflictResult()).toBe(false)
  expect(putFile).not.toHaveBeenCalled()
  await store.getState().refreshConflict()
  expect(store.getState().conflictDraft?.result).toBe('merged')
  expect(await store.getState().saveConflictResult()).toBe(true)
  expect(putFile).toHaveBeenCalledWith('A', 'merged', 'v2')
  expect(store.getState().source).toBe('merged')
})

it('retains the edited result on close and navigation, while rejecting same-mtime disk changes', async () => {
  const store = await comparison()
  store.getState().setConflictResult('merged')
  store.getState().closeConflict()
  await store.getState().load('B')
  vi.mocked(getFile).mockResolvedValue(file('new disk', 'v4'))
  await store.getState().load('A')
  await store.getState().openConflict()
  expect(store.getState().conflictDraft?.result).toBe('merged')
  expect(store.getState().diskChange?.version).toBe('v4')
  expect(await store.getState().saveConflictResult()).toBe(false)
  expect(putFile).not.toHaveBeenCalled()
})

it('refreshes disk after a rejected write and retains the draft until explicit refresh', async () => {
  const store = await comparison()
  store.getState().setConflictResult('merged')
  vi.mocked(putFile).mockRejectedValueOnce(new ApiError(409, 'changed'))
  vi.mocked(getFile).mockResolvedValue(file('new disk', 'v4'))
  expect(await store.getState().saveConflictResult()).toBe(false)
  expect(store.getState().conflictDraft?.result).toBe('merged')
  expect(store.getState().conflictDraft?.diskVersion).toBe('v2')
  expect(store.getState().diskChange?.version).toBe('v4')
  expect(await store.getState().saveConflictResult()).toBe(false)
  await store.getState().refreshConflict()
  expect(await store.getState().saveConflictResult()).toBe(true)
  expect(putFile).toHaveBeenLastCalledWith('A', 'merged', 'v4')
})

it('preserves local and result after deletion and read failure without recreating the file', async () => {
  const store = await comparison()
  store.getState().setConflictResult('merged')
  store.getState().notifyDiskChange(0, true)
  expect(await store.getState().saveConflictResult()).toBe(false)
  expect(await store.getState().useConflictDisk()).toBe(false)
  vi.mocked(getFile).mockRejectedValueOnce(new ApiError(410, 'missing or unreadable'))
  await store.getState().refreshConflict()
  expect(store.getState().source).toBe('local')
  expect(store.getState().conflictDraft?.result).toBe('merged')
  expect(store.getState().diskChange?.deleted).toBe(true)
  expect(putFile).not.toHaveBeenCalled()
  vi.mocked(getFile).mockRejectedValueOnce(new Error('offline'))
  await store.getState().refreshConflict()
  expect(store.getState().conflictDraft?.error).toBe('read')
})

it('retains the result on write failure and allows retry against the same displayed version', async () => {
  const store = await comparison()
  store.getState().setConflictResult('merged')
  vi.mocked(putFile).mockRejectedValueOnce(new Error('offline'))
  expect(await store.getState().saveConflictResult()).toBe(false)
  expect(store.getState().source).toBe('local')
  expect(store.getState().conflictDraft?.error).toBe('save')
  expect(await store.getState().saveConflictResult()).toBe(true)
})

it('makes Use disk undoable and rejects a disk replacement while adoption is pending', async () => {
  const store = await comparison()
  const delayed = deferred<ReturnType<typeof file>>()
  vi.mocked(getFile).mockReturnValueOnce(delayed.promise)
  const useDisk = store.getState().useConflictDisk()
  delayed.resolve(file('replacement', 'v4'))
  expect(await useDisk).toBe(false)
  expect(store.getState().source).toBe('local')
  vi.mocked(getFile).mockResolvedValue(file('replacement', 'v4'))
  await store.getState().refreshConflict()
  expect(await store.getState().useConflictDisk()).toBe(true)
  expect(store.getState().source).toBe('replacement')
  expect(putFile).not.toHaveBeenCalled()
  store.getState().undo()
  expect(store.getState().source).toBe('local')
  await vi.advanceTimersByTimeAsync(600)
  expect(putFile).toHaveBeenCalledWith('A', 'local', 'v4')
})

it('does not overwrite local edits made during a result save or apply completion to another document', async () => {
  const store = await comparison()
  store.getState().setConflictResult('merged')
  const write = deferred<{ mtimeMs: number; version: string }>()
  vi.mocked(putFile).mockReturnValueOnce(write.promise)
  const save = store.getState().saveConflictResult()
  store.getState().setSourceFromEditor('new local')
  vi.mocked(getFile).mockResolvedValue(file('B', 'B1'))
  await store.getState().load('B')
  vi.mocked(getFile).mockResolvedValue(file('merged', 'v3'))
  write.resolve({ mtimeMs: 2, version: 'v3' })
  await save
  expect(store.getState().source).toBe('B')
  await store.getState().load('A')
  expect(store.getState().source).toBe('new local')
  expect(store.getState().savedSource).toBe('merged')
  expect(store.getState().conflict).toBe(true)
})

it('renders the fixed notice and comparison actions with stale draft guards', async () => {
  const store = await comparison()
  store.getState().closeConflict()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const button = (key: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === key)!
  try {
    await act(async () => root.render(<ConflictPanel store={store} />))
    expect(host.querySelector('.conflict-notice')).not.toBeNull()
    await act(async () => button('conflictCompare').click())
    expect([...host.querySelectorAll('pre')].map((n) => n.textContent)).toEqual(['base', 'local', 'disk'])
    expect(host.querySelector('textarea')?.value).toBe('local')
    const textarea = host.querySelector('textarea')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'manual result')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(store.getState().conflictDraft?.result).toBe('manual result')
    act(() => store.getState().setSourceFromEditor('new local'))
    expect(button('conflictSaveResult').disabled).toBe(true)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('conflictStale')
    await act(async () => button('conflictRefresh').click())
    expect(host.querySelector('textarea')?.value).toBe('manual result')
    expect(button('conflictSaveResult').disabled).toBe(false)
    await act(async () => button('conflictSaveResult').click())
    expect(putFile).toHaveBeenCalledWith('A', 'manual result', 'v2')
    expect(host.querySelector('.conflict-notice')).toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})

it('rejects Use disk when a newer disk notification overtakes its read', async () => {
  const store = await comparison()
  const delayed = deferred<ReturnType<typeof file>>()
  vi.mocked(getFile).mockReturnValueOnce(delayed.promise)
  const useDisk = store.getState().useConflictDisk()
  vi.mocked(getFile).mockResolvedValue(file('new disk', 'v4'))
  store.getState().notifyDiskChange(1)
  await vi.advanceTimersByTimeAsync(0)
  delayed.resolve(file('disk', 'v2'))
  expect(await useDisk).toBe(false)
  expect(store.getState().source).toBe('local')
  expect(store.getState().diskChange?.version).toBe('v4')
})

it('ignores reversed comparison refresh completion and retains manual result edits', async () => {
  const store = await comparison()
  const first = deferred<ReturnType<typeof file>>()
  vi.mocked(getFile).mockReturnValueOnce(first.promise)
  const older = store.getState().refreshConflict()
  const second = deferred<ReturnType<typeof file>>()
  vi.mocked(getFile).mockReturnValueOnce(second.promise)
  const newer = store.getState().refreshConflict()
  store.getState().setConflictResult('manual')
  second.resolve(file('new disk', 'v4'))
  await newer
  first.resolve(file('stale disk', 'v3'))
  await older
  expect(store.getState().conflictDraft?.diskVersion).toBe('v4')
  expect(store.getState().conflictDraft?.result).toBe('manual')
  expect(store.getState().conflictDraft?.refreshing).toBe(false)
})

it('keeps result edits protected by the lifecycle guard even when local equals base', async () => {
  const store = await comparison()
  store.getState().setSource('base')
  await store.getState().refreshConflict()
  store.getState().setConflictResult('manual')
  expect(store.getState().hasPendingWrites()).toBe(true)
  await vi.advanceTimersByTimeAsync(600)
  expect(putFile).not.toHaveBeenCalled()
})

it.each(['event', 'refresh', 'use disk'])('blocks apply after production 410 during %s without claiming deletion', async (action) => {
  const store = await comparison()
  store.getState().setConflictResult('manual')
  vi.mocked(getFile).mockRejectedValueOnce(new ApiError(410, 'missing or unreadable'))
  if (action === 'event') {
    store.getState().notifyDiskChange(1)
    await vi.advanceTimersByTimeAsync(0)
  } else if (action === 'refresh') {
    await store.getState().refreshConflict()
  } else {
    expect(await store.getState().useConflictDisk()).toBe(false)
  }
  expect(store.getState().source).toBe('local')
  expect(store.getState().conflictDraft?.result).toBe('manual')
  expect(store.getState().conflictDraft?.diskContent).toBe('disk')
  expect(store.getState().conflictDraft?.diskVersion).toBeNull()
  expect(store.getState().conflictDraft?.error).toBe('read')
  expect(store.getState().diskChange?.deleted).toBe(false)
  expect(await store.getState().saveConflictResult()).toBe(false)
  expect(await store.getState().useConflictDisk()).toBe(false)
  expect(putFile).not.toHaveBeenCalled()
  vi.mocked(getFile).mockResolvedValue(file('restored', 'v4'))
  await store.getState().refreshConflict()
  expect(store.getState().conflictDraft?.result).toBe('manual')
  expect(store.getState().conflictDraft?.diskVersion).toBe('v4')
  expect(await store.getState().saveConflictResult()).toBe(true)
})

it('ignores a stale failed read after a newer comparison refresh', async () => {
  const store = await comparison()
  let reject!: (error: Error) => void
  const olderRead = new Promise<ReturnType<typeof file>>((_, r) => { reject = r })
  vi.mocked(getFile).mockReturnValueOnce(olderRead)
  const oldRefresh = store.getState().refreshConflict()
  vi.mocked(getFile).mockResolvedValue(file('new disk', 'v4'))
  await store.getState().refreshConflict()
  reject(new ApiError(410, 'missing or unreadable'))
  await oldRefresh
  expect(store.getState().conflictDraft?.diskVersion).toBe('v4')
  expect(store.getState().conflictDraft?.error).toBeNull()
})
