// @vitest-environment jsdom
import { installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDoc } from '../ui/documents/store'
import { SessionView } from '../ui/app/SessionView'
import { requestViewCommand, useCommentRail, useOverlay } from '../ui/app/overlayStore'

vi.mock('../ui/review/CommentRail', () => ({ CommentRail: () => <div data-testid="rail" /> }))
vi.mock('../ui/modes/reading/SelectionToolbar', () => ({ SelectionToolbar: () => null }))
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
  useOverlay.setState({ open: null, owner: null, viewCommand: null })
  useDoc.setState({ ...initial, sessionId: 'A', status: 'ready', mode: 'reading',
    load: vi.fn().mockResolvedValue(undefined), meta: null })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); useDoc.setState(initial)
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); installHost(null)
})
function render(source: string) {
  useDoc.setState({ source, savedSource: source })
  act(() => root.render(<SessionView sessionId="A" />))
}
const dialog = () => host.querySelector('[role="dialog"]')?.getAttribute('aria-label')

it('toggles the comment rail and publishes its state for the native menu', () => {
  render('{>>@Alex: a note<<}')
  expect(useCommentRail.getState()).toEqual({ available: true, open: true })
  act(() => requestViewCommand('toggle-comments'))
  expect(host.querySelector('[data-testid="rail"]')).toBeNull()
  expect(useCommentRail.getState()).toEqual({ available: true, open: false })
  act(() => requestViewCommand('toggle-comments'))
  expect(host.querySelector('[data-testid="rail"]')).not.toBeNull()
  expect(useCommentRail.getState()).toEqual({ available: true, open: true })
  act(() => useDoc.getState().setMode('source'))
  expect(useCommentRail.getState()).toEqual({ available: false, open: false })
  act(() => root.unmount())
  root = createRoot(host)
  expect(useCommentRail.getState()).toEqual({ available: false, open: false })
})

it('opens Settings and Resolved discussions without toggling an open panel closed', () => {
  render('body')
  act(() => requestViewCommand('resolved'))
  expect(dialog()).toBe('Resolved discussions (0)')
  act(() => requestViewCommand('resolved'))
  expect(dialog()).toBe('Resolved discussions (0)')
  act(() => requestViewCommand('settings'))
  expect(useOverlay.getState()).toMatchObject({ open: 'settings', owner: 'A' })
  act(() => requestViewCommand('settings'))
  expect(useOverlay.getState()).toMatchObject({ open: 'settings', owner: 'A' })
})

it('ignores a command raised before the view mounted', () => {
  act(() => requestViewCommand('resolved'))
  render('body')
  expect(dialog()).toBeUndefined()
  expect(useOverlay.getState().open).toBeNull()
})
