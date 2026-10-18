// @vitest-environment jsdom
import { undo, redo, undoDepth } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { useNav } from '../ui/app/navStore'
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
  vi.restoreAllMocks()
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

it('navigates through editor geometry without requiring an off-screen line in the DOM', () => {
  const scrollIntoView = vi.spyOn(EditorView, 'scrollIntoView')
  act(() => useDoc.getState().adoptDiskContent('# First\r\n\r\n## Second\r\n', 4, 'headings'))
  const view = editor()
  const offset = view.state.doc.toString().indexOf('## Second')
  vi.spyOn(view, 'documentTop', 'get').mockReturnValue(100)
  const lineBlockAt = vi.spyOn(view, 'lineBlockAt').mockReturnValue({ top: 900 } as ReturnType<EditorView['lineBlockAt']>)
  const domAtPos = vi.spyOn(view, 'domAtPos').mockImplementation(() => { throw new Error('Line is not rendered') })
  expect(useNav.getState().sourceHeadingTop?.(offset)).toBe(1000)
  act(() => useDoc.getState().scroller!(offset, 1))
  expect(lineBlockAt).toHaveBeenCalledWith(offset)
  expect(view.state.selection.main.anchor).toBe(offset)
  expect(domAtPos).not.toHaveBeenCalled()
  expect(scrollIntoView).toHaveBeenCalledWith(offset, { y: 'start', yMargin: 24 })
  act(() => useDoc.getState().setMode('reading'))
  expect(useNav.getState().sourceHeadingTop).toBeNull()
  expect(useDoc.getState().scroller).toBeNull()
})

it('discards editor undo when its document closes', async () => {
  act(() => editor().dispatch({ changes: { from: 5, insert: ' edited' } }))
  expect(undoDepth(editor().state)).toBe(1)
  await act(async () => { await useDoc.getState().closeDocument(a, async () => {}) })
  expect(host.querySelector('.cm-editor')).toBeNull()
  disk.set(a, 'alpha edited')
  await act(async () => useDoc.getState().load(a))
  expect(undoDepth(editor().state)).toBe(0)
})

it('freezes editor mutations and undo without losing selection or text on conflict', () => {
  const view = editor()
  act(() => view.dispatch({ changes: { from: 5, insert: ' local' }, selection: { anchor: 2, head: 4 } }))
  act(() => useDoc.getState().notifyDiskChange(0, true))
  expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')
  act(() => view.dispatch({ changes: { from: 0, insert: 'forbidden' } }))
  act(() => { undo(view) })
  expect(view.state.doc.toString()).toBe('alpha local')
  expect(useDoc.getState().source).toBe('alpha local')
  expect(view.state.selection.main.from).toBe(2)
  expect(view.state.selection.main.to).toBe(4)
})

it('searches virtualized source with literal case-aware queries and restores selection without changing history', async () => {
  const { useSourceSearch } = await import('../ui/find/source')
  const { getSearchQuery, searchPanelOpen } = await import('@codemirror/search')
  act(() => editor().dispatch({ changes: { from: 0, to: 5, insert: 'Review\n'.repeat(500) + 'review' }, selection: { anchor: 1, head: 3 } }))
  const view = editor()
  const adapter = useSourceSearch.getState().adapter!
  const historyBefore = undoDepth(view.state)
  const before = useDoc.getState().source
  expect(adapter.matches('review', false)).toHaveLength(501)
  expect(adapter.matches('review', true)).toEqual([{ from: 3500, to: 3506 }])
  act(() => adapter.query('review', true))
  expect(getSearchQuery(view.state).caseSensitive).toBe(true)
  expect(searchPanelOpen(view.state)).toBe(true)
  const scroll = vi.spyOn(EditorView, 'scrollIntoView')
  act(() => adapter.select(adapter.matches('review', true)[0]!, null))
  expect(scroll).toHaveBeenCalledWith(3500, expect.objectContaining({ y: 'nearest' }))
  expect(useDoc.getState().source).toBe(before)
  act(() => adapter.close())
  expect(view.state.selection.main.from).toBe(1)
  expect(view.state.selection.main.to).toBe(3)
  expect(searchPanelOpen(view.state)).toBe(false)
  expect(undoDepth(view.state)).toBe(historyBefore)
})
