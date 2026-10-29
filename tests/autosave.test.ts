import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostError, installHost } from '../ui/app/host'
import { createDocStore } from '../ui/documents/store'
import { fakeHost } from './helpers/host'

const AUTOSAVE_MS = 600
const getFile = vi.fn()
const putFile = vi.fn()
let store: ReturnType<typeof createDocStore>

async function load(content = 'hello'): Promise<void> {
  getFile.mockResolvedValue({ content, version: 'base' })
  await store.getState().load('s1')
}

describe('autosave', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    getFile.mockReset()
    putFile.mockReset().mockResolvedValue({ version: 'saved' })
    installHost(fakeHost({ getFile, putFile,
      getSession: async (sessionId) => ({ sessionId, displayName: 'f.md', path: '/f.md' }),
    }))
    store = createDocStore()
    await load()
  })
  afterEach(() => {
    installHost(null)
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('debounces an edit into a single disk write after the idle delay', async () => {
    store.getState().setSource('hello world')
    expect(putFile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(putFile).toHaveBeenCalledExactlyOnceWith('s1', 'hello world', 'base')
    expect(store.getState().savedSource).toBe('hello world')
  })

  it('coalesces a burst of edits into one write of the latest text', async () => {
    store.getState().setSource('a')
    store.getState().setSource('ab')
    store.getState().setSource('abc')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(putFile).toHaveBeenCalledExactlyOnceWith('s1', 'abc', 'base')
  })

  it('restores the original EOL on the wire', async () => {
    store = createDocStore()
    await load('a\r\nb')
    store.getState().setSource('a\nb\nc')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(putFile).toHaveBeenCalledWith('s1', 'a\r\nb\r\nc', 'base')
  })

  it('does not write an unedited loaded file, including CRLF frontmatter', async () => {
    const source = '---\r\ntitle: "Plan"\r\nitems: [one, two]\r\n---\r\n\r\n# Body\r\n'
    store = createDocStore()
    await load(source)
    expect(await store.getState().prepareToClose()).toBe(true)
    expect(putFile).not.toHaveBeenCalled()
    expect(store.getState().source).toBe(source.replaceAll('\r\n', '\n'))
  })

  it('retains exact CRLF frontmatter while saving a body edit', async () => {
    const prefix = '---\r\ntitle: "Plan"\r\nitems: [one, two]\r\n---\r\n\r\n'
    store = createDocStore()
    await load(prefix + '# Body\r\n')
    store.getState().setSource(store.getState().source + 'Accepted edit\n')
    await store.getState().prepareToClose()
    expect(putFile).toHaveBeenCalledWith('s1', prefix + '# Body\r\nAccepted edit\r\n', 'base')
  })

  it('does not schedule writes while a disk conflict is unresolved', async () => {
    store.getState().notifyDiskChange(true)
    store.getState().setSource('edit during conflict')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(putFile).not.toHaveBeenCalled()
  })

  it('a failed write pauses saves and retains dirty source for recovery', async () => {
    putFile.mockRejectedValue(new Error('disk unavailable'))
    store.getState().setSource('accepted edit')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(store.getState()).toMatchObject({ recovery: 'saveFailed' })
    expect(store.getState().savedSource).toBe('hello')
    expect(store.getState().source).toBe('accepted edit')
  })

  it('a host conflict raises the conflict flag instead of a generic error', async () => {
    putFile.mockRejectedValue(new HostError('conflict', 'file changed on disk'))
    store.getState().setSource('racing edit')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(store.getState().recovery).toBe('changed')
  })

  it('retains the exact accepted buffer after saving', async () => {
    putFile.mockResolvedValue({ version: 'saved', content: 'REWRITTEN\n' })
    store.getState().setSource('hello world')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(store.getState().source).toBe('hello world')
    expect(store.getState().savedSource).toBe('hello world')
  })
})
