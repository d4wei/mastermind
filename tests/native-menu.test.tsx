// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeReviewer } from '../ui/desktop/NativeReviewer'
import { publishCommentRail, useCommentRail, useOverlay } from '../ui/app/overlayStore'
import { useDoc } from '../ui/documents/store'
import { useConfig } from '../ui/app/configStore'
import { installHost } from '../ui/app/host'
import type { ClientConfig } from '../ui/settings/types'
import { fakeHost } from './helpers/host'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), navigate: vi.fn(), id: null as string | null }))
vi.mock('../ui/desktop/bridge', () => ({ nativeBridge: { invoke: mocks.invoke, listen: mocks.listen } }))
vi.mock('../ui/app/route', () => ({ navigate: mocks.navigate,
  useRoute: () => mocks.id === null ? { kind: 'home' } : { kind: 'doc', sessionId: mocks.id } }))
vi.mock('../ui/app/App', () => ({ App: () => null }))

const snapshot = () => ({ files: [{ id: '0', path: '/first.md' }, { id: '1', path: '/second.md' }],
  activation_revision: 0, active_id: null, opening_errors: [] })
const setup = () => ({ completed: true, revision: 0, values: { authorTag: 'Alex', uiLang: 'en' },
  saved: { authorTag: true, uiLang: true }, protected: { authorTag: false, uiLang: false } })
const initialDocuments = useDoc.getState()
const initialConfig = useConfig.getState()
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  installHost(fakeHost())
  mocks.id = '0'
  mocks.navigate.mockReset()
  mocks.listen.mockReset().mockResolvedValue(() => {})
  mocks.invoke.mockReset().mockImplementation(async (command: string, args?: { id?: number }) => {
    if (command === 'snapshot') return snapshot()
    if (command === 'setup_snapshot') return setup()
    if (command === 'close_document') return { ...snapshot(), files: snapshot().files.filter((file) => Number(file.id) !== args!.id),
      activation_revision: 1, active_id: 1 }
    return undefined
  })
  useDoc.setState({ ...initialDocuments, sessionId: '0', status: 'ready', mode: 'reading' })
  host = document.createElement('div')
  host.id = 'root'
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useDoc.setState(initialDocuments, true)
  useConfig.setState(initialConfig, true)
  useOverlay.setState({ open: null, owner: null, viewCommand: null })
  publishCommentRail({ available: false, open: false })
  installHost(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const mount = async () => { await act(async () => root.render(<NativeReviewer />)) }
const menuAction = async (action: string) => {
  const listener = mocks.listen.mock.calls.find(([event]) => event === 'menu-action')![1]
  await act(async () => listener(action))
}
const lastState = () => mocks.invoke.mock.calls.filter(([command]) => command === 'set_menu_state').at(-1)![1]

it('reports the active document, mode, and comment rail to the native menu', async () => {
  mocks.id = null
  await mount()
  expect(lastState()).toEqual({ documentActive: false, mode: 'reading', commentsAvailable: false, commentsOpen: false })

  mocks.id = '0'
  await mount()
  expect(lastState()).toEqual({ documentActive: true, mode: 'reading', commentsAvailable: false, commentsOpen: false })

  act(() => publishCommentRail({ available: true, open: true }))
  expect(lastState()).toEqual({ documentActive: true, mode: 'reading', commentsAvailable: true, commentsOpen: true })

  // A mode changed elsewhere, such as by the Cmd+E shortcut, moves the checks too.
  act(() => useDoc.getState().setMode('source'))
  expect(lastState()).toMatchObject({ mode: 'source' })

  act(() => useDoc.setState({ status: 'loading' }))
  expect(lastState()).toMatchObject({ documentActive: false })
})

it('sets the menu language from the interface language', async () => {
  await mount()
  expect(mocks.invoke).toHaveBeenCalledWith('set_menu_language', { lang: 'en' })
  expect(mocks.invoke).not.toHaveBeenCalledWith('set_menu_language', { lang: 'zh-CN' })
  act(() => useConfig.setState({ config: { uiLang: 'zh-CN' } as ClientConfig }))
  expect(mocks.invoke).toHaveBeenCalledWith('set_menu_language', { lang: 'zh-CN' })
})

it('switches the mode from the View items', async () => {
  await mount()
  await menuAction('view-markdown')
  expect(useDoc.getState().mode).toBe('source')
  expect(lastState()).toMatchObject({ mode: 'source' })
  await menuAction('view-read')
  expect(useDoc.getState().mode).toBe('reading')
})

it.each(['settings', 'resolved', 'toggle-comments'] as const)('forwards %s to the document view', async (action) => {
  await mount()
  const before = useOverlay.getState().viewCommand
  await menuAction(action)
  const command = useOverlay.getState().viewCommand
  expect(command).toEqual({ command: action })
  expect(command).not.toBe(before)
})

it('runs Save As on the active document and follows the copy', async () => {
  const saveCopy = vi.fn(async () => { useDoc.setState({ sessionId: '2' }); return '2' })
  useDoc.setState({ saveCopy })
  await mount()
  await menuAction('save-copy')
  expect(saveCopy).toHaveBeenCalledWith()
  expect(mocks.navigate).toHaveBeenCalledWith('/d/2')
})

it('closes the active file through the file pill close path', async () => {
  const closeDocument = vi.fn(async (_id: string, release: () => Promise<void>) => { await release(); return true })
  useDoc.setState({ closeDocument, prepareToClose: vi.fn(async () => true), pendingDocuments: () => [] })
  await mount()
  await act(async () => { await vi.runOnlyPendingTimersAsync() })
  await menuAction('close-file')
  await act(async () => { await vi.runOnlyPendingTimersAsync() })
  expect(closeDocument).toHaveBeenCalledWith('0', expect.any(Function), undefined)
  expect(mocks.invoke).toHaveBeenCalledWith('close_document', expect.objectContaining({ id: 0 }))
  expect(mocks.navigate).toHaveBeenCalledWith('/d/1')
})

it('ignores document actions while no document is active', async () => {
  useDoc.setState({ status: 'loading' })
  const saveCopy = vi.fn()
  useDoc.setState({ saveCopy })
  await mount()
  for (const action of ['settings', 'view-markdown', 'save-copy', 'close-file', 'unknown']) await menuAction(action)
  expect(useDoc.getState().mode).toBe('reading')
  expect(useOverlay.getState().viewCommand).toBeNull()
  expect(saveCopy).not.toHaveBeenCalled()
  expect(mocks.invoke).not.toHaveBeenCalledWith('close_document', expect.anything())
  expect(useCommentRail.getState()).toEqual({ available: false, open: false })
})
