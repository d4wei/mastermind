// @vitest-environment jsdom
import { installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LOADING_DELAY_MS, LoadingState, StateNote } from '../ui/app/LoadingState'
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
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); useDoc.setState(initial)
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); installHost(null)
})

const reducedMotion = (reduce: boolean) => vi.stubGlobal('matchMedia', (query: string) =>
  ({ matches: reduce && query.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} }))

it('shows its spinner and label only once the wait has lasted its delay', () => {
  act(() => root.render(<LoadingState label="Loading…" />))
  expect(host.querySelector('.state-note[role="status"]')).not.toBeNull()
  expect(host.querySelector('.loading-spinner')).toBeNull()
  expect(host.textContent).toBe('')
  act(() => vi.advanceTimersByTime(LOADING_DELAY_MS - 1))
  expect(host.querySelector('.loading-spinner')).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(host.querySelector('.loading-spinner.loading-spinner-turning')).not.toBeNull()
  expect(host.textContent).toBe('Loading…')
})

it('draws a still spinner under reduced motion', () => {
  reducedMotion(true)
  act(() => root.render(<LoadingState label="Loading…" />))
  act(() => vi.advanceTimersByTime(LOADING_DELAY_MS))
  const spinner = host.querySelector('.loading-spinner')
  expect(spinner).not.toBeNull()
  expect(spinner!.classList.contains('loading-spinner-turning')).toBe(false)
  expect(host.querySelector('.state-note-enter')).toBeNull()
  expect(host.textContent).toBe('Loading…')
})

it('places a static note at the same position without a spinner', () => {
  act(() => root.render(<StateNote><p>Nothing here</p></StateNote>))
  expect(host.querySelector('.state-note .state-note-text')?.textContent).toBe('Nothing here')
  expect(host.querySelector('.loading-spinner')).toBeNull()
})

it('shows the delayed loading state while the document loads', () => {
  useDoc.setState({ ...initial, sessionId: 'A', status: 'loading', load: vi.fn().mockResolvedValue(undefined) })
  act(() => root.render(<SessionView sessionId="A" />))
  expect(host.querySelector('.state-note[role="status"]')).not.toBeNull()
  expect(host.querySelector('.loading-spinner')).toBeNull()
  act(() => vi.advanceTimersByTime(LOADING_DELAY_MS))
  expect(host.querySelector('.state-note')?.textContent).toBe('Loading…')
  expect(host.querySelector('.loading-spinner')).not.toBeNull()
})

it('shows the delayed loading state while the Markdown editor chunk loads, then the editor', async () => {
  useDoc.setState({ ...initial, sessionId: 'A', status: 'ready', mode: 'source', source: 'Text', savedSource: 'Text',
    load: vi.fn().mockResolvedValue(undefined) })
  act(() => root.render(<SessionView sessionId="A" />))
  const fallback = () => host.querySelector('.doc-column .state-note')
  expect(fallback()).not.toBeNull()
  expect(host.querySelector('.doc-column .loading-spinner')).toBeNull()
  act(() => vi.advanceTimersByTime(LOADING_DELAY_MS))
  expect(fallback()?.textContent).toBe('Loading…')
  expect(host.querySelector('.doc-column .loading-spinner')).not.toBeNull()
  await act(async () => { gate.release(); await vi.advanceTimersByTimeAsync(0) })
  expect(host.querySelector('[data-testid="source-editor"]')).not.toBeNull()
  expect(fallback()).toBeNull()
})
