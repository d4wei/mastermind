import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fakeHost } from './helpers/host'
import { HostError, installHost } from '../ui/app/host'
import { createDocStore } from '../ui/documents/store'
import { closeRequestedFiles } from '../ui/desktop/agent-close'
import { releaseDrafts, useDrafts } from '../ui/review/drafts'

const getFile = vi.fn(), putFile = vi.fn()
beforeEach(() => {
  getFile.mockReset().mockImplementation(async (id: string) => ({ content: id, version: id }))
  putFile.mockReset().mockResolvedValue({ version: 'saved' })
  installHost(fakeHost({ getFile, putFile,
    getSession: async (id) => ({ sessionId: id, path: `/${id}.md`, displayName: `${id}.md` }) }))
})
afterEach(() => { for (const id of ['A', 'B', 'C']) releaseDrafts(id); installHost(null) })

async function open(ids: string[]) {
  const store = createDocStore()
  for (const id of ids) await store.getState().load(id)
  const released: string[] = []
  const close = (id: string) => store.getState().closeDocument(id, async () => { released.push(id) })
  return { store, released, close, admitted: new Set(ids) }
}

function draft(id: string) {
  const pending = { id, key: 'comment', label: `${id}.md · Comment`, discard: () => {}, order: 1 }
  useDrafts.setState(({ documents }) => ({
    documents: new Map(documents).set(id, { values: new Map(), pending: new Map([['comment', pending]]) }),
  }))
}

it('saves and closes a clean document without prompting', async () => {
  const { store, released, close, admitted } = await open(['A'])
  store.getState().setSource('A edited')
  expect(await closeRequestedFiles(store.getState(), ['A'], admitted, close)).toEqual([{ id: 'A', status: 'closed' }])
  expect(putFile).toHaveBeenCalledWith('A', 'A edited', 'A')
  expect(released).toEqual(['A'])
  expect(store.getState().hasDocument('A')).toBe(false)
})

it('keeps a document with an unfinished draft open', async () => {
  const { store, released, close, admitted } = await open(['A', 'B'])
  draft('A')
  expect(await closeRequestedFiles(store.getState(), ['A', 'B'], admitted, close)).toEqual([
    { id: 'A', status: 'blocked', reason: 'pending_draft' },
    { id: 'B', status: 'closed' },
  ])
  expect(released).toEqual(['B'])
  expect(store.getState().hasDocument('A')).toBe(true)
})

it('keeps a document whose edits could not be saved', async () => {
  const { store, released, close, admitted } = await open(['A'])
  putFile.mockRejectedValue(new HostError('failure', 'disk full'))
  store.getState().setSource('A edited')
  expect(await closeRequestedFiles(store.getState(), ['A'], admitted, close)).toEqual([
    { id: 'A', status: 'blocked', reason: 'unsaved_edits' },
  ])
  expect(released).toEqual([])
  expect(store.getState().source).toBe('A edited')
})

it('keeps a clean document in recovery open', async () => {
  const { store, released, close, admitted } = await open(['A'])
  getFile.mockRejectedValue(new HostError('missing', 'deleted'))
  store.getState().notifyDiskChange()
  await vi.waitFor(() => expect(store.getState().needsAttention('A')).toBe(true))
  expect(await closeRequestedFiles(store.getState(), ['A'], admitted, close)).toEqual([
    { id: 'A', status: 'blocked', reason: 'recovery' },
  ])
  expect(released).toEqual([])
})

it('reports a document that is not open without affecting the others', async () => {
  const { store, released, close, admitted } = await open(['A', 'B'])
  expect(await closeRequestedFiles(store.getState(), ['A', 'C', 'B'], admitted, close)).toEqual([
    { id: 'A', status: 'closed' },
    { id: 'C', status: 'error', error: 'document_not_open' },
    { id: 'B', status: 'closed' },
  ])
  expect(released).toEqual(['A', 'B'])
})

it('reports a failed native close as an error and continues', async () => {
  const { store, admitted } = await open(['A', 'B'])
  const close = vi.fn(async (id: string) => {
    if (id === 'A') throw new Error('registry unavailable')
    return true
  })
  expect(await closeRequestedFiles(store.getState(), ['A', 'B'], admitted, close)).toEqual([
    { id: 'A', status: 'error', error: 'close_failed' },
    { id: 'B', status: 'closed' },
  ])
})
