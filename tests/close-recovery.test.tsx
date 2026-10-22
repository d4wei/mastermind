// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createReactHost, removeReactHost } from './helpers/dom'
import { fakeHost } from './helpers/host'
import { installHost, HostError } from '../ui/app/host'
import { createDocStore } from '../ui/documents/store'
import { confirmClose } from '../ui/desktop/confirm-close'
import { CloseDialog, useClosePrompt } from '../ui/desktop/CloseDialog'
import { DraftScope, pendingDrafts, releaseDrafts, useDraftFocus, useDraftGuard, useDraftState } from '../ui/review/drafts'

const getFile = vi.fn(), putFile = vi.fn(), saveCopy = vi.fn()
const file = (content: string, version = content) => ({ content, version, mtimeMs: 1 })
let view: ReturnType<typeof createReactHost>
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  getFile.mockReset().mockResolvedValue(file('base'))
  putFile.mockReset().mockRejectedValue(new HostError('failure', 'readonly'))
  saveCopy.mockReset().mockResolvedValue(null)
  installHost(fakeHost({ getFile, putFile, saveCopy,
    getSession: async (id) => ({ sessionId: id, path: id + '.md', displayName: id + '.md' }) }))
  view = createReactHost()
  act(() => view.root.render(<CloseDialog />))
})
afterEach(() => {
  removeReactHost(view.root, view.host)
  releaseDrafts('A'); releaseDrafts('B')
  useClosePrompt.setState({ prompt: null }); useDraftFocus.setState({ target: null })
  installHost(null); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals()
})
const choose = async (choice: 'save' | 'discard' | 'cancel') => {
  await act(async () => { useClosePrompt.getState().choose(choice) })
}
async function dirty(ids = ['A']) {
  const store = createDocStore()
  for (const id of ids) { await store.getState().load(id); store.getState().setSource(id + ' edited') }
  return store
}

it('flushes ordinary autosave and closes without a prompt', async () => {
  const store = await dirty()
  putFile.mockResolvedValue({ version: 'saved' })
  let result: Map<string, number> | null = null
  await act(async () => { result = await confirmClose(store.getState(), ['A'], vi.fn()) })
  expect(result).toEqual(new Map())
  expect(document.querySelector('dialog[open]')).toBeNull()
  expect(putFile).toHaveBeenCalledWith('A', 'A edited', 'base')
})

it('lets a slow close be cancelled without claiming to cancel the dispatched write', async () => {
  const store = await dirty()
  let finish!: (value: { version: string }) => void
  putFile.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  let closing!: ReturnType<typeof confirmClose>
  await act(async () => { closing = confirmClose(store.getState(), ['A'], vi.fn()) })
  expect(document.querySelector('dialog[open]')).toBeNull()
  await act(async () => vi.advanceTimersByTimeAsync(400))
  expect(document.querySelectorAll('dialog[open] button')).toHaveLength(1)
  await choose('cancel'); expect(await closing).toBeNull()
  expect(store.getState().saving).toBe(true)
  await act(async () => finish({ version: 'saved' }))
  expect(store.getState().savedSource).toBe('A edited')
})

it('does not reuse a discard approval for a newer local revision', async () => {
  const store = await dirty()
  let closing!: ReturnType<typeof confirmClose>
  await act(async () => { closing = confirmClose(store.getState(), ['A'], vi.fn()) })
  await choose('discard')
  const allowed = await closing
  getFile.mockResolvedValue(file('incoming', 'new'))
  await act(async () => { await store.getState().useConflictDisk() })
  act(() => store.getState().setSource('new edits'))
  const release = vi.fn()
  expect(await store.getState().closeDocument('A', release, allowed!.get('A'))).toBe(false)
  expect(release).not.toHaveBeenCalled()
  expect(store.getState().source).toBe('new edits')
})

it('offers exactly three failed-save choices and discards only the shown revision', async () => {
  const store = await dirty(), resume = vi.fn()
  let closing!: ReturnType<typeof confirmClose>
  await act(async () => { closing = confirmClose(store.getState(), ['A'], resume) })
  expect(document.querySelectorAll('dialog[open] button')).toHaveLength(3)
  expect(document.querySelector('dialog')?.textContent).toContain('A.md')
  expect(document.querySelector('dialog textarea')).toBeNull()
  await choose('discard')
  const approved = await closing
  const writes = putFile.mock.calls.length, release = vi.fn()
  expect(await store.getState().closeDocument('A', release, approved!.get('A'))).toBe(true)
  expect(release).toHaveBeenCalledOnce()
  expect(putFile).toHaveBeenCalledTimes(writes)
})

it('retains work and resumes the file when failed-save close is cancelled', async () => {
  const store = await dirty(), resume = vi.fn()
  let closing!: ReturnType<typeof confirmClose>
  await act(async () => { closing = confirmClose(store.getState(), ['A'], resume) })
  await choose('cancel')
  expect(await closing).toBeNull()
  expect(resume).toHaveBeenCalledWith('A')
  expect(store.getState().source).toBe('A edited')
})

it('hides the close sheet for a picker and restores it without an error on cancellation', async () => {
  const store = await dirty()
  let resolve!: (value: null) => void
  saveCopy.mockImplementation(() => new Promise((done) => { resolve = done }))
  let closing!: ReturnType<typeof confirmClose>
  await act(async () => { closing = confirmClose(store.getState(), ['A'], vi.fn()) })
  await choose('save')
  expect(document.querySelector('dialog[open]')).toBeNull()
  await act(async () => resolve(null))
  expect(document.querySelector('dialog[open]')).not.toBeNull()
  expect(document.querySelector('dialog [role=alert]')).toBeNull()
  await choose('cancel'); await closing
  expect(store.getState().source).toBe('A edited')
})

it('updates one close sheet after copy failure, retaining the buffer', async () => {
  const store = await dirty()
  saveCopy.mockRejectedValue(new Error('unwritable destination'))
  let closing!: ReturnType<typeof confirmClose>
  await act(async () => { closing = confirmClose(store.getState(), ['A'], vi.fn()) })
  await choose('save')
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
  expect(document.querySelector('dialog [role=alert]')).not.toBeNull()
  expect(store.getState().source).toBe('A edited')
  await choose('cancel'); await closing
})

it('removes only successfully copied files from a quit decision', async () => {
  const store = await dirty(['A', 'B'])
  saveCopy.mockResolvedValueOnce({ meta: { sessionId: 'copy-A' }, file: file('A edited') })
  let closing!: ReturnType<typeof confirmClose>
  await act(async () => { closing = confirmClose(store.getState(), undefined, vi.fn()) })
  await choose('save')
  expect(saveCopy).toHaveBeenNthCalledWith(1, 'A', 'A edited', true)
  expect(document.querySelector('dialog')?.textContent).not.toContain('A.md')
  expect(document.querySelector('dialog')?.textContent).toContain('B.md')
  expect(store.getState().hasDocument('A')).toBe(true)
  expect(store.getState().hasDocument('copy-A')).toBe(false)
  await choose('discard')
  expect([...(await closing)!.keys()]).toEqual(['A', 'B'])
})

function Draft({ id }: { id: string }) {
  const [text, setText] = useDraftState('comment', 'unfinished')
  useDraftGuard('comment', id + '.md · Comment', !!text, () => {
    document.querySelector<HTMLTextAreaElement>('[data-original-composer]')?.focus()
  }, () => setText(''))
  return <textarea data-original-composer value={text} onChange={(e) => setText(e.target.value)} />
}

it('returns Cancel to the original draft with its text and caret intact', async () => {
  const store = createDocStore(); await store.getState().load('A')
  act(() => view.root.render(<><DraftScope id="A"><Draft id="A" /></DraftScope><CloseDialog /></>))
  const original = view.host.querySelector('textarea')!
  original.focus(); original.setSelectionRange(2, 5)
  let closing!: ReturnType<typeof confirmClose>
  await act(async () => { closing = confirmClose(store.getState(), ['A'], vi.fn()) })
  expect(document.querySelectorAll('dialog button')).toHaveLength(2)
  expect(document.querySelector('dialog textarea')).toBeNull()
  await choose('cancel'); expect(await closing).toBeNull()
  expect(document.activeElement).toBe(original)
  expect(original.value).toBe('unfinished')
  expect([original.selectionStart, original.selectionEnd]).toEqual([2, 5])
})

it('retains drafts across unmounts and discards only the named file’s drafts', async () => {
  const store = createDocStore(); await store.getState().load('A'); await store.getState().load('B')
  act(() => view.root.render(<DraftScope id="A"><Draft id="A" /></DraftScope>))
  act(() => view.root.render(<DraftScope id="B"><Draft key="B" id="B" /></DraftScope>))
  expect(pendingDrafts()).toHaveLength(2)
  let closing!: ReturnType<typeof confirmClose>
  await act(async () => { closing = confirmClose(store.getState(), ['A'], vi.fn()) })
  await choose('discard'); await closing
  expect(pendingDrafts().map((draft) => draft.id)).toEqual(['B'])
})
