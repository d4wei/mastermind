// @vitest-environment jsdom
import { installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LOADING_DELAY_MS } from '../ui/app/LoadingState'
import { useDoc } from '../ui/documents/store'
import { SessionView } from '../ui/app/SessionView'

// The Markdown editor's chunk stays unloaded until the test releases it.
const gate = vi.hoisted(() => {
  let release!: () => void
  const loaded = new Promise<void>((resolve) => { release = resolve })
  return { loaded, release }
})
vi.mock('../ui/modes/source/SourceEditor', async () => {
  await gate.loaded
  return { SourceEditor: () => <div data-testid="source-editor" /> }
})
vi.mock('../ui/app/ConflictPanel', () => ({ ConflictPanel: () => null }))

let host: HTMLDivElement
let root: Root
const initial = useDoc.getState()

beforeEach(() => {
  installHost(fakeHost())
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useDoc.setState({ ...initial, sessionId: 'A', status: 'ready', mode: 'reading', source: 'Reading text',
    savedSource: 'Reading text', load: vi.fn().mockResolvedValue(undefined) })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); useDoc.setState(initial)
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); installHost(null)
})

it('keeps the reading view in place until the Markdown editor chunk loads', async () => {
  act(() => root.render(<SessionView sessionId="A" />))
  const article = () => host.querySelector<HTMLElement>('article.md-root')
  expect(article()?.textContent).toBe('Reading text')
  await act(async () => { useDoc.getState().setMode('source'); await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS * 2) })
  expect(useDoc.getState().mode).toBe('source')
  expect(article()?.textContent).toBe('Reading text')
  expect(article()!.closest('[hidden], [style*="display: none"]')).toBeNull()
  expect(host.querySelector('.state-note')).toBeNull()
  expect(host.querySelector('[data-testid="source-editor"]')).toBeNull()
  await act(async () => { gate.release(); await vi.advanceTimersByTimeAsync(0) })
  expect(host.querySelector('[data-testid="source-editor"]')).not.toBeNull()
  expect(article()).toBeNull()
})
