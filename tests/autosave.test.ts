import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionMeta } from '../ui/app/hostTypes'

// Mock the HTTP client before importing the store. The autosave paths under test
// touch no DOM, so this runs in the default node env with fake timers.
vi.mock('../ui/app/api', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public data?: unknown,
    ) {
      super(message)
    }
  }
  return {
    ApiError,
    putFile: vi.fn(),
    getFile: vi.fn(),
    getSession: vi.fn(),
  }
})

import { ApiError, getFile, putFile } from '../ui/app/api'
import { useDoc } from '../ui/app/store'

const AUTOSAVE_MS = 600

function seed(over: Partial<ReturnType<typeof useDoc.getState>> = {}): void {
  useDoc.setState({
    sessionId: 's1',
    source: 'hello',
    savedSource: 'hello',
    eol: 'lf',
    mtimeMs: 100,
    version: 'base',
    saving: false,
    savingKind: null,
    conflict: false,
    notice: null,
    history: [],
    externalVersion: 0,
    flushEditor: null,
    meta: { displayName: 'f.md', path: '/f.md' } as unknown as SessionMeta,
    ...over,
  })
}

describe('autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(putFile).mockReset().mockResolvedValue({ mtimeMs: 200, version: 'saved' })
    vi.mocked(getFile).mockReset()
    seed()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces an edit into a single disk write after the idle delay', async () => {
    useDoc.getState().setSource('hello world')
    expect(putFile).not.toHaveBeenCalled() // still within the debounce window

    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(putFile).toHaveBeenCalledTimes(1)
    expect(putFile).toHaveBeenCalledWith('s1', 'hello world', 'base')
    expect(useDoc.getState().savedSource).toBe('hello world')
  })

  it('coalesces a burst of edits into one write of the latest text', async () => {
    useDoc.getState().setSource('a')
    useDoc.getState().setSource('ab')
    useDoc.getState().setSource('abc')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)

    expect(putFile).toHaveBeenCalledTimes(1)
    expect(putFile).toHaveBeenCalledWith('s1', 'abc', 'base')
  })

  it('restores the original EOL on the wire', async () => {
    seed({ eol: 'crlf', source: 'a\nb', savedSource: 'a\nb' })
    useDoc.getState().setSource('a\nb\nc')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(putFile).toHaveBeenCalledWith('s1', 'a\r\nb\r\nc', 'base')
  })

  it('saves unedited YAML frontmatter byte-for-byte, including CRLF', async () => {
    const source = '---\ntitle: "Plan"\nitems: [one, two]\n---\n\n# Body\n'
    seed({ source, savedSource: '', eol: 'crlf' })
    vi.mocked(getFile).mockResolvedValue({ content: source, mtimeMs: 100, version: 'disk' })
    await useDoc.getState().autosave()
    expect(putFile).toHaveBeenCalledWith('s1', source.replaceAll('\n', '\r\n'), 'base')
  })

  it('does not schedule writes while a disk conflict is unresolved', async () => {
    seed({ conflict: true })
    useDoc.getState().setSource('edit during conflict')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(putFile).not.toHaveBeenCalled()
  })

  it('a failed write is never silent — it raises the saveFailed notice', async () => {
    vi.mocked(putFile).mockRejectedValue(new Error('network down'))
    useDoc.getState().setSource('doomed edit')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)

    expect(useDoc.getState().notice).toEqual({ kind: 'error', msg: 'saveFailed' })
  })

  it('a 409 raises the conflict flag instead of a generic error', async () => {
    vi.mocked(putFile).mockRejectedValue(new ApiError(409, 'file changed on disk'))
    useDoc.getState().setSource('racing edit')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)

    expect(useDoc.getState().conflict).toBe(true)
    expect(useDoc.getState().notice).toBeNull()
  })

  it('retains the exact accepted buffer after saving', async () => {
    vi.mocked(putFile).mockResolvedValue({ mtimeMs: 250, content: 'REWRITTEN\n' } as never)
    useDoc.getState().setSource('hello world')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)

    expect(useDoc.getState().source).toBe('hello world')
    expect(useDoc.getState().savedSource).toBe('hello world')
  })
})
