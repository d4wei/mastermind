// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HostError, installHost } from '../ui/app/host'
import type { FileResponse } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { ConflictPanel } from '../ui/app/ConflictPanel'
import { Notifications } from '../ui/app/Notifications'
import { SessionView } from '../ui/app/SessionView'
import { createDocStore, useDoc } from '../ui/documents/store'

const getFile = vi.fn<(id: string) => Promise<FileResponse>>()
const putFile = vi.fn()
const saveCopy = vi.fn()
const lossyFile = { content: 'a�b\n', version: 'v1', lossy: true }
let host: HTMLDivElement
let root: Root
const initialDoc = useDoc.getState()
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')

beforeEach(() => {
  installHost(fakeHost({ getFile, putFile, saveCopy,
    getSession: async (id) => ({ sessionId: id, displayName: `${id}.md`, path: id }) }))
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  getFile.mockReset().mockResolvedValue(lossyFile)
  putFile.mockReset().mockResolvedValue({ version: 'v2' })
  saveCopy.mockReset().mockResolvedValue(null)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); useDoc.setState(initialDoc)
  window.getSelection()?.removeAllRanges()
  if (rangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeBounds)
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
  installHost(null); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals()
})

function attempts(store: ReturnType<typeof createDocStore>) {
  store.getState().setSource('changed')
  store.getState().setSourceFromEditor('changed')
  store.getState().applyEdits([{ from: 0, to: 1, insert: 'changed' }])
  store.getState().undo()
  store.getState().queueAutosave()
}

it('opens a file that is not valid UTF-8 read-only and never schedules or lists a save', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  expect(store.getState()).toMatchObject({ lossy: true, recovery: null, source: lossyFile.content })
  attempts(store)
  await vi.advanceTimersByTimeAsync(1000)
  expect(store.getState()).toMatchObject({ source: lossyFile.content, revision: 0, history: [] })
  expect(putFile).not.toHaveBeenCalled()
  expect(store.getState().pendingDocuments()).toEqual([])
  expect(await store.getState().prepareToClose()).toBe(true)
})

it('becomes editable when a later read finds the file rewritten as UTF-8', async () => {
  const store = createDocStore()
  await store.getState().load('A')
  getFile.mockResolvedValue({ content: 'ab\n', version: 'v2', lossy: false })
  store.getState().notifyDiskChange()
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getState()).toMatchObject({ lossy: false, source: 'ab\n' })
  store.getState().setSource('abc\n')
  await vi.advanceTimersByTimeAsync(1000)
  expect(putFile).toHaveBeenCalledWith('A', 'abc\n', 'v2')
})

it('marks a document lossy when the host refuses its write as not UTF-8, without offering Retry', async () => {
  getFile.mockResolvedValue({ content: 'ab\n', version: 'v1' })
  putFile.mockRejectedValue(new HostError('notUtf8', 'not_utf8'))
  const store = createDocStore()
  await store.getState().load('A')
  store.getState().setSource('abc\n')
  await vi.advanceTimersByTimeAsync(1000)
  expect(store.getState()).toMatchObject({ lossy: true, recovery: null, source: 'abc\n' })
  attempts(store)
  // A host that omits the field cannot clear lossiness it proved for the same version.
  store.getState().notifyDiskChange()
  await vi.advanceTimersByTimeAsync(1000)
  expect(store.getState()).toMatchObject({ lossy: true, source: 'abc\n' })
  expect(putFile).toHaveBeenCalledOnce()
  // The retained edits stay listed so closing offers Save As instead of discarding them.
  expect(await store.getState().prepareToClose()).toBe(false)
  expect(putFile).toHaveBeenCalledOnce()
  await act(async () => root.render(<Notifications><ConflictPanel store={store} /></Notifications>))
  expect(host.textContent).toContain('not valid UTF-8')
  expect([...host.querySelectorAll('.conflict-actions button')].map((button) => button.textContent)).toEqual(['Save As…'])
  expect(host.querySelector('.notification-dismiss')).toBeNull()
})

it('admits a successful Save As copy as an editable UTF-8 document', async () => {
  saveCopy.mockResolvedValue({ meta: { sessionId: 'B', displayName: 'B.md', path: 'B' },
    file: { content: lossyFile.content, version: 'b1', lossy: false } })
  getFile.mockImplementation(async (id) => id === 'B' ? { content: lossyFile.content, version: 'b1', lossy: false } : lossyFile)
  const store = createDocStore()
  await store.getState().load('A')
  expect(await store.getState().saveCopy()).toBe('B')
  expect(store.getState()).toMatchObject({ sessionId: 'B', lossy: false })
  store.getState().setSource('edited\n')
  expect(store.getState().source).toBe('edited\n')
})

it('disables review actions and shows the read-only notice for a lossy document', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true,
    value: () => ({ top: 100, left: 100, width: 40, height: 10, bottom: 110, right: 140 }) })
  getFile.mockResolvedValue({ content: 'Passage {>>@Alex: note<<}\n', version: 'v1', lossy: true })
  await useDoc.getState().load('A')
  await act(async () => root.render(<Notifications><SessionView sessionId="A" /></Notifications>))
  expect(host.textContent).toContain('This file is not valid UTF-8, so it is read-only.')
  expect([...host.querySelectorAll('.conflict-actions button')].map((button) => button.textContent)).toEqual(['Save As…'])
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('article p')!.firstChild!)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
  await act(async () => vi.advanceTimersByTimeAsync(120))
  const actions = [...host.querySelectorAll<HTMLButtonElement>('.sel-toolbar button')]
  expect(actions.map((button) => button.textContent)).toEqual(['Comment', 'Suggest change'])
  expect(actions.every((button) => button.disabled)).toBe(true)
})
