// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeReviewer } from '../ui/desktop/NativeReviewer'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), navigate: vi.fn(), load: vi.fn(), chinese: false,
  listen: vi.fn(), prepareToClose: vi.fn(),
}))
vi.mock('../ui/desktop/bridge', () => ({ nativeBridge: {
  invoke: mocks.invoke, listen: mocks.listen,
} }))
vi.mock('../ui/app/route', () => ({ navigate: mocks.navigate }))
vi.mock('../ui/documents/store', () => ({ useDoc: Object.assign(() => null, {
  getState: () => ({ notifyDiskChange: vi.fn(), hasPendingWrites: () => false,
    prepareToClose: mocks.prepareToClose }),
}) }))
vi.mock('../ui/app/configStore', () => ({ useConfig: Object.assign(() => mocks.chinese, {
  getState: () => ({ load: mocks.load }),
}) }))
vi.mock('../ui/app/App', () => ({ App: ({ home, onboarding }: { home: React.ReactNode; onboarding?: React.ReactNode }) => onboarding ?? home }))

let host: HTMLDivElement
let root: Root
const snapshot = (revision = 0, activeId: number | null = null, errors: string[] = []) => ({
  files: ['/first.md', '/second.md'], activation_revision: revision,
  active_id: activeId, opening_errors: errors,
})
const setup = () => ({ completed: true, revision: 0,
  values: { authorTag: 'Alex', uiLang: 'en', translationLanguage: null },
  saved: { authorTag: true, uiLang: true, translationLanguage: true },
  protected: { authorTag: false, uiLang: false, translationLanguage: false },
})
const other = (command: string) => command === 'setup_snapshot' ? setup() : undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.chinese = false
  mocks.navigate.mockReset()
  mocks.load.mockReset().mockResolvedValue(undefined)
  mocks.listen.mockReset().mockResolvedValue(() => {})
  mocks.prepareToClose.mockReset().mockResolvedValue(true)
  mocks.invoke.mockReset().mockImplementation(async (command: string) =>
    command === 'snapshot' ? snapshot() : other(command))
  host = document.createElement('div')
  host.id = 'root'
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
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot' ? snapshot(1, 0) : other(command))
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
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot' ? snapshot(2, 0) : other(command))
  await poll()
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/0')
})

it('keeps one snapshot in flight and ignores it after unmount', async () => {
  let resolve!: (value: ReturnType<typeof snapshot>) => void
  mocks.invoke.mockImplementation((command: string) => command === 'snapshot'
    ? new Promise((done) => { resolve = done }) : Promise.resolve(other(command)))
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
    return other(command)
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
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot' ? snapshot(1, 1) : other(command))
  await mount()
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot' ? snapshot(2, null, ['No readable files']) : other(command))
  await poll()
  expect(mocks.navigate).toHaveBeenCalledTimes(1)
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/1')
  expect(host.textContent).toContain('No readable files')
})

it('keeps opening activation and close registration alive before setup completes', async () => {
  let completed = false
  let release!: () => void
  mocks.load.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'snapshot') return snapshot(3, 1)
    if (command === 'setup_snapshot') return { ...setup(), completed }
    if (command === 'confirm_setup') { completed = true; return { ...setup(), completed } }
  })
  await mount()
  expect(host.querySelector('.native-setup')).not.toBeNull()
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/1')
  expect(mocks.invoke).toHaveBeenCalledWith('close_ready')
  await act(async () => button('Open files…').click())
  expect(mocks.invoke).toHaveBeenCalledWith('choose_files')
  await act(async () => host.querySelector('form')!.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true })))
  await poll()
  expect(host.querySelector('.native-setup')).not.toBeNull()
  await act(async () => release())
  expect(host.querySelector('.native-setup')).toBeNull()
  expect(button('Open files…')).toBeDefined()
  expect(mocks.navigate).toHaveBeenCalledTimes(1)
})

it('keeps file admission usable while setup loading fails and supports explicit retry', async () => {
  let failed = true
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'snapshot') return snapshot(1, 0)
    if (command === 'setup_snapshot') {
      if (failed) throw new Error('Preferences unreadable')
      return { ...setup(), completed: false }
    }
  })
  await mount()
  expect(host.textContent).toContain('Preferences unreadable')
  expect(host.querySelector('.native-setup')).toBeNull()
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/0')
  await act(async () => button('Open files…').click())
  expect(mocks.invoke).toHaveBeenCalledWith('choose_files')
  failed = false
  await act(async () => button('Retry loading setup').click())
  expect(host.querySelector('.native-setup')).not.toBeNull()
  expect(host.textContent).not.toContain('Preferences unreadable')
})

it('does not repeat setup for saved completion or mutate saved choices on open', async () => {
  await mount()
  expect(host.querySelector('.native-setup')).toBeNull()
  await act(async () => button('Open files…').click())
  await poll()
  expect(mocks.invoke).not.toHaveBeenCalledWith('confirm_setup', expect.anything())
  expect(mocks.invoke).not.toHaveBeenCalledWith('write_preferences', expect.anything())
})

it('previews the setup language on native Open files without writing preferences', async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'snapshot') return snapshot()
    if (command === 'setup_snapshot') return { ...setup(), completed: false }
  })
  await mount()
  await act(async () => host.querySelector<HTMLButtonElement>('[name="uiLang"][value="zh-CN"]')!.click())
  expect(button('打开文件…')).toBeDefined()
  await act(async () => button('打开文件…').click())
  expect(mocks.invoke).toHaveBeenCalledWith('choose_files')
  expect(mocks.invoke).not.toHaveBeenCalledWith('write_preferences', expect.anything())
  expect(mocks.invoke).not.toHaveBeenCalledWith('confirm_setup', expect.anything())
})

it.each(['success', 'write failure', 'reload failure'] as const)(
  'waits for setup confirmation before quit: %s', async (outcome) => {
    let finishWrite!: (value: ReturnType<typeof setup>) => void
    let failWrite!: (error: Error) => void
    let finishReload!: () => void
    let failReload!: (error: Error) => void
    const write = new Promise<ReturnType<typeof setup>>((resolve, reject) => {
      finishWrite = resolve; failWrite = reject
    })
    mocks.load.mockImplementation(() => new Promise<void>((resolve, reject) => {
      finishReload = resolve; failReload = reject
    }))
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'confirm_setup') return write
      return Promise.resolve(command === 'snapshot' ? snapshot()
        : command === 'setup_snapshot' ? { ...setup(), completed: false } : undefined)
    })
    await mount()
    await act(async () => host.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })))
    const close = mocks.listen.mock.calls.find(([event]) => event === 'close-requested')![1] as () => void
    await act(async () => close())
    expect(host.inert).toBe(true)
    expect(mocks.prepareToClose).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalledWith('finish_close')

    if (outcome === 'write failure') {
      await act(async () => failWrite(new Error('Cannot save setup')))
    } else {
      await act(async () => finishWrite(setup()))
      expect(host.inert).toBe(true)
      expect(mocks.prepareToClose).not.toHaveBeenCalled()
      expect(mocks.invoke).not.toHaveBeenCalledWith('finish_close')
      await act(async () => outcome === 'reload failure'
        ? failReload(new Error('Cannot reload choices')) : finishReload())
    }

    expect(host.inert).toBe(false)
    if (outcome === 'success') {
      expect(mocks.prepareToClose).toHaveBeenCalledTimes(1)
      expect(mocks.invoke).toHaveBeenCalledWith('finish_close')
      expect(host.querySelector('.native-setup')).toBeNull()
    } else {
      expect(mocks.invoke).toHaveBeenCalledWith('cancel_close')
      expect(mocks.invoke).not.toHaveBeenCalledWith('finish_close')
      expect(host.querySelector('.native-setup')).not.toBeNull()
      expect(host.querySelector('fieldset')!.disabled).toBe(false)
      expect(host.textContent).toContain('Could not complete setup')
    }
  },
)
