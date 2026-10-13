// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeReviewer } from '../src/ui/native/NativeReviewer'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), navigate: vi.fn(), chinese: false,
}))
vi.mock('../src/ui/native/bridge', () => ({ nativeBridge: {
  invoke: mocks.invoke, listen: vi.fn().mockResolvedValue(() => {}),
} }))
vi.mock('../src/ui/app/route', () => ({ navigate: mocks.navigate }))
vi.mock('../src/ui/app/store', () => ({ useDoc: Object.assign(() => null, {
  getState: () => ({ notifyDiskChange: vi.fn(), hasPendingWrites: () => false }),
}) }))
vi.mock('../src/ui/app/configStore', () => ({ useConfig: () => mocks.chinese }))
vi.mock('../src/ui/app/App', () => ({ App: ({ home }: { home: React.ReactNode }) => home }))

let host: HTMLDivElement
let root: Root
const snapshot = (revision = 0, activeId: number | null = null, errors: string[] = []) => ({
  files: ['/first.md', '/second.md'], activation_revision: revision,
  active_id: activeId, opening_errors: errors,
})
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.chinese = false
  mocks.navigate.mockReset()
  mocks.invoke.mockReset().mockImplementation(async (command: string) =>
    command === 'snapshot' ? snapshot() : undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const mount = async () => { await act(async () => root.render(<NativeReviewer />)) }
const poll = async () => { await act(async () => vi.advanceTimersByTimeAsync(500)) }
const button = (label: string) => Array.from(host.querySelectorAll('button'))
  .find((item) => item.textContent === label)!

it('activates only newer requests, including reopening an existing file', async () => {
  await mount()
  expect(mocks.navigate).not.toHaveBeenCalled()
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot' ? snapshot(1, 0) : undefined)
  await poll()
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/0')
  act(() => {
    const select = host.querySelector('select')!
    select.value = '1'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await poll()
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/1')
  expect(mocks.navigate).toHaveBeenCalledTimes(2)
  mocks.invoke.mockImplementation(async () => snapshot(2, 0))
  await poll()
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/0')
})

it('keeps one snapshot in flight and ignores it after unmount', async () => {
  let resolve!: (value: ReturnType<typeof snapshot>) => void
  mocks.invoke.mockImplementation((command: string) => command === 'snapshot'
    ? new Promise((done) => { resolve = done }) : Promise.resolve())
  await mount()
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(mocks.invoke.mock.calls.filter(([command]) => command === 'snapshot')).toHaveLength(1)
  act(() => root.unmount())
  await act(async () => resolve(snapshot(1, 0)))
  expect(mocks.navigate).not.toHaveBeenCalled()
  root = createRoot(host)
})

it.each([[false, 'Open files…'], [true, '打开文件…']] as const)(
  'opens the native dialog from the bar and home with language %s', async (chinese, label) => {
    mocks.chinese = chinese
    await mount()
    const buttons = Array.from(host.querySelectorAll('button')).filter((item) => item.textContent === label)
    expect(buttons).toHaveLength(2)
    await act(async () => { buttons[0]!.click(); buttons[1]!.click() })
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'choose_files')).toHaveLength(2)
  },
)

it('dismisses retained graphical errors without erasing local command errors', async () => {
  let errors = ['Missing /lost.md']
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'snapshot') return snapshot(0, null, errors)
    if (command === 'choose_files') throw new Error('Dialog unavailable')
    if (command === 'dismiss_opening_errors') errors = []
  })
  await mount()
  await act(async () => button('Open files…').click())
  await poll()
  expect(host.textContent).toContain('Missing /lost.md')
  expect(host.textContent).toContain('Dialog unavailable')
  await act(async () => button('Dismiss opening errors').click())
  await poll()
  expect(host.textContent).not.toContain('Missing /lost.md')
  expect(host.textContent).toContain('Dialog unavailable')
})

it('keeps the selected document when a request has no admitted file', async () => {
  mocks.invoke.mockImplementation(async () => snapshot(1, 1))
  await mount()
  mocks.invoke.mockImplementation(async () => snapshot(2, null, ['No readable files']))
  await poll()
  expect(mocks.navigate).toHaveBeenCalledTimes(1)
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/1')
  expect(host.textContent).toContain('No readable files')
})
