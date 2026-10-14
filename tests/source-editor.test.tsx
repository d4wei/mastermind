// @vitest-environment jsdom
import { undo, redo, undoDepth } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { useDoc } from '../ui/documents/store'
import { SourceEditor } from '../ui/modes/source/SourceEditor'

const getFile = vi.fn()
const getSession = vi.fn()
const putFile = vi.fn()

let host: HTMLDivElement
let root: Root
let sequence = 0
let a: string
let b: string
const disk = new Map<string, string>()

function EditorMode() {
  const mode = useDoc((state) => state.mode)
  const status = useDoc((state) => state.status)
  return mode === 'source' && status === 'ready' ? <SourceEditor /> : null
}

function editor(): EditorView {
  const node = host.querySelector<HTMLElement>('.cm-editor')!
  expect(node).not.toBeNull()
  return EditorView.findFromDOM(node)!
}

beforeEach(async () => {
  installHost(fakeHost({ getFile, getSession, putFile }))
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  a = `source-A-${++sequence}`
  b = `source-B-${sequence}`
  disk.set(a, 'alpha')
  disk.set(b, 'beta')
  vi.mocked(getSession).mockReset().mockImplementation(async (id) => ({
    id, displayName: id, path: id,
  }) as never)
  vi.mocked(getFile).mockReset().mockImplementation(async (id) => ({
    content: disk.get(id)!, version: `disk-${id}`, mtimeMs: 1,
  }))
  vi.mocked(putFile).mockReset().mockResolvedValue({ version: 'saved', mtimeMs: 2 })
  await useDoc.getState().load(a)
  useDoc.getState().setMode('source')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<EditorMode />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals(); installHost(null)
})

it('retains real CodeMirror undo and selection across A to B to A', async () => {
  const outgoing = editor()
  const outgoingFlusher = useDoc.getState().flushEditor!
  act(() => outgoing.dispatch({ changes: { from: 5, insert: ' edited' },
    selection: { anchor: 2, head: 4 } }))
  expect(useDoc.getState().source).toBe('alpha edited')
  expect(useDoc.getState().history).toEqual([])
  await act(async () => useDoc.getState().load(b))
  expect(editor()).not.toBe(outgoing)
  expect(outgoing.dom.isConnected).toBe(false)
  const currentFlusher = useDoc.getState().flushEditor
  act(() => outgoingFlusher())
  expect(useDoc.getState().source).toBe('beta')
  expect(useDoc.getState().flushEditor).toBe(currentFlusher)
  act(() => editor().dispatch({ changes: { from: 4, insert: ' B' } }))
  await act(async () => useDoc.getState().load(a))
  const restored = editor()
  expect(restored.state.selection.main.anchor).toBe(2)
  expect(restored.state.selection.main.head).toBe(4)
  expect(undoDepth(restored.state)).toBe(1)
  act(() => { expect(undo(restored)).toBe(true) })
  expect(useDoc.getState().source).toBe('alpha')
  act(() => { expect(redo(restored)).toBe(true) })
  expect(useDoc.getState().source).toBe('alpha edited')
  await act(async () => useDoc.getState().load(b))
  expect(useDoc.getState().source).toBe('beta B')
  act(() => { expect(undo(editor())).toBe(true) })
  expect(useDoc.getState().source).toBe('beta')
})

it('retains editor history through reading mode and binds a fresh transaction adapter', () => {
  act(() => editor().dispatch({ changes: { from: 0, insert: 'local ' } }))
  const originalVersion = useDoc.getState().externalVersion
  act(() => useDoc.getState().setMode('reading'))
  expect(host.querySelector('.cm-editor')).toBeNull()
  act(() => useDoc.getState().setMode('source'))
  expect(undoDepth(editor().state)).toBe(1)
  act(() => { expect(undo(editor())).toBe(true) })
  expect(useDoc.getState().source).toBe('alpha')
  expect(useDoc.getState().externalVersion).toBe(originalVersion)
})

it('starts a fresh editor after external replacement and never revives the old buffer', () => {
  act(() => editor().dispatch({ changes: { from: 0, insert: 'old ' } }))
  const outgoing = editor()
  act(() => useDoc.getState().adoptDiskContent('external\r\n', 3, 'external-version'))
  expect(editor()).not.toBe(outgoing)
  expect(editor().state.doc.toString()).toBe('external\n')
  act(() => { expect(undo(editor())).toBe(false) })
  expect(useDoc.getState().source).toBe('external\n')
  act(() => editor().dispatch({ changes: { from: 0, insert: 'current ' } }))
  expect(useDoc.getState().source).toBe('current external\n')
})

it('invalidates retained history even when external edits return to the same source', () => {
  act(() => editor().dispatch({ changes: { from: 5, insert: ' edited' } }))
  const revision = useDoc.getState().revision
  act(() => useDoc.getState().setMode('reading'))
  act(() => {
    useDoc.getState().setSource('other')
    useDoc.getState().setSource('alpha edited')
  })
  expect(useDoc.getState().revision).toBeGreaterThan(revision)
  act(() => useDoc.getState().setMode('source'))
  expect(editor().state.doc.toString()).toBe('alpha edited')
  act(() => { expect(undo(editor())).toBe(false) })
  expect(useDoc.getState().source).toBe('alpha edited')
})
