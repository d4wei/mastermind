// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeReviewer } from '../ui/desktop/NativeReviewer'
import { useOverlay } from '../ui/app/overlayStore'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), navigate: vi.fn(), load: vi.fn(), chinese: false,
  listen: vi.fn(), closeDocument: vi.fn(), prepareToClose: vi.fn(), id: null as string | null,
  status: 'ready' as 'loading' | 'ready' | 'error', appRenders: 0,
}))
vi.mock('../ui/desktop/bridge', () => ({ nativeBridge: {
  invoke: mocks.invoke, listen: mocks.listen,
} }))
// The route names the active file; the store has no active document while one loads or after it fails.
vi.mock('../ui/app/route', () => ({ navigate: mocks.navigate,
  useRoute: () => mocks.id === null ? { kind: 'home' } : { kind: 'doc', sessionId: mocks.id } }))
vi.mock('../ui/documents/store', () => ({ useDoc: Object.assign(() => ({ sessionId: null, status: mocks.status, needsAttention: () => false }), {
  getState: () => ({ notifyDiskChange: vi.fn(),
    prepareToClose: mocks.prepareToClose, closeDocument: mocks.closeDocument, pendingDocuments: () => [] }),
}) }))
vi.mock('../ui/app/configStore', () => ({ useConfig: Object.assign((select: (state: unknown) => unknown) =>
  select({ config: { uiLang: mocks.chinese ? 'zh-CN' : 'en' } }), {
  getState: () => ({ load: mocks.load }),
}) }))
vi.mock('../ui/app/App', () => ({ App: ({ home, onboarding }: { home: React.ReactNode; onboarding?: React.ReactNode }) => {
  mocks.appRenders++
  return onboarding ?? home
} }))

let host: HTMLDivElement
let root: Root
const snapshot = (revision = 0, activeId: number | null = null, errors: string[] = []) => ({
  files: [{ id: '0', path: '/first.md' }, { id: '1', path: '/second.md' }], activation_revision: revision,
  active_id: activeId, opening_errors: errors,
})
const setup = () => ({ completed: true, revision: 0,
  values: { authorTag: 'Alex', uiLang: 'en' },
  saved: { authorTag: true, uiLang: true },
  protected: { authorTag: false, uiLang: false },
})
const other = (command: string) => command === 'setup_snapshot' ? setup() : undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.id = null
  mocks.status = 'ready'
  mocks.chinese = false
  mocks.navigate.mockReset()
  mocks.load.mockReset().mockResolvedValue(undefined)
  mocks.listen.mockReset().mockResolvedValue(() => {})
  mocks.closeDocument.mockReset().mockImplementation(async (_id, release) => { await release(); return true })
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
  .find((item) => item.textContent === label || item.getAttribute('aria-label') === label)!

it('activates only newer requests, including reopening an existing file', async () => {
  await mount()
  expect(mocks.navigate).not.toHaveBeenCalled()
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot' ? snapshot(1, 0) : other(command))
  await poll()
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/0')
  act(() => {
    button('second.md').click()
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

it.each([[false, 'Open Markdown files…'], [true, '打开 Markdown 文件…']] as const)(
  'has one open action and moves it from home to the bar with language %s', async (chinese, label) => {
    mocks.chinese = chinese
    mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot'
      ? { ...snapshot(), files: [] } : other(command))
    await mount()
    const open = button(label)
    expect(host.querySelectorAll('.native-open')).toHaveLength(1)
    expect(open.classList.contains('native-open-home')).toBe(true)
    expect(host.querySelector('.native-wordmark')?.textContent).toBe(
      '█▀▄▀█ ▄▀█ █▀ ▀█▀ █▀▀ █▀█ █▀▄▀█ █ █▄░█ █▀▄\n█░▀░█ █▀█ ▄█ ░█░ ██▄ █▀▄ █░▀░█ █ █░▀█ █▄▀')
    expect(host.querySelector('.native-home p')).toBeNull()
    expect(open.querySelector('.native-open-label')?.textContent).toBe(label)
    expect(open.querySelector('.native-open-shortcut')?.getAttribute('aria-hidden')).toBe('true')
    await act(async () => open.click())
    mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot' ? snapshot(1, 0) : other(command))
    await poll()
    expect(button(label)).toBe(open)
    expect(open.classList.contains('native-open-home')).toBe(false)
    expect(open.querySelector('.native-open-label')).toBeNull()
    expect(open.querySelector('.native-open-shortcut')).toBeNull()
    await act(async () => open.click())
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
  await act(async () => button('Open Markdown files…').click())
  await poll()
  expect(host.textContent).toContain('Missing /lost.md')
  expect(host.textContent).toContain('Dialog unavailable')
  await act(async () => (host.querySelector('[aria-label="Dismiss"]') as HTMLButtonElement).click())
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
  await act(async () => button('Open Markdown files…').click())
  expect(mocks.invoke).toHaveBeenCalledWith('choose_files')
  await act(async () => host.querySelector('form')!.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true })))
  await poll()
  expect(host.querySelector('.native-setup')).not.toBeNull()
  await act(async () => release())
  expect(host.querySelector('.native-setup')).toBeNull()
  expect(button('Open Markdown files…')).toBeDefined()
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
  await act(async () => button('Open Markdown files…').click())
  expect(mocks.invoke).toHaveBeenCalledWith('choose_files')
  failed = false
  await act(async () => button('Retry loading setup').click())
  expect(host.querySelector('.native-setup')).not.toBeNull()
  expect(host.textContent).not.toContain('Preferences unreadable')
})

it('does not repeat setup for saved completion or mutate saved choices on open', async () => {
  await mount()
  expect(host.querySelector('.native-setup')).toBeNull()
  await act(async () => button('Open Markdown files…').click())
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
  expect(button('打开 Markdown 文件…')).toBeDefined()
  await act(async () => button('打开 Markdown 文件…').click())
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


it('updates the native title and selected pill when the active document changes', async () => {
  mocks.id = '0'
  await mount()
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('first.md')
  expect(mocks.invoke).toHaveBeenCalledWith('set_window_title', { value: 'mastermind - /first.md' })
  mocks.id = '1'
  await mount()
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('second.md')
  expect(mocks.invoke.mock.calls.filter(([command]) => command === 'set_window_title').at(-1)).toEqual(['set_window_title', { value: 'mastermind - /second.md' }])
})

it.each([['0', '/d/1'], ['1', '/d/0']] as const)(
  'closes file %s without nesting buttons or changing a background selection', async (closing, destination) => {
    mocks.id = '0'
    const remaining = snapshot().files.filter((file) => file.id !== closing)
    mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot' ? snapshot()
      : command === 'close_document' ? { ...snapshot(1, Number(remaining[0]!.id)), files: remaining }
      : other(command))
    await mount()
    expect(host.querySelector('button button')).toBeNull()
    await act(async () => button(`Close ${closing === '0' ? 'first' : 'second'}.md`).click())
    expect(mocks.closeDocument).toHaveBeenCalledWith(closing, expect.any(Function), undefined)
    expect(mocks.invoke).toHaveBeenCalledWith('close_document', { id: Number(closing), activeId: 0, activationRevision: 0 })
    expect(host.querySelectorAll('.native-file-pill')).toHaveLength(1)
    expect(mocks.navigate).toHaveBeenLastCalledWith(destination)
    // A snapshot captured before the close cannot resurrect its pill.
    await poll()
    expect(host.querySelectorAll('.native-file-pill')).toHaveLength(1)
  },
)

it.each(['loading', 'error'] as const)('keeps the routed file selected when a background file closes while it is %s', async (status) => {
  mocks.id = '1'
  mocks.status = status
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot' ? snapshot()
    : command === 'close_document' ? { ...snapshot(1, 1), files: [snapshot().files[1]] }
    : other(command))
  await mount()
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('second.md')
  await act(async () => button('Close first.md').click())
  expect(mocks.invoke).toHaveBeenCalledWith('close_document', { id: 0, activeId: 1, activationRevision: 0 })
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/1')
})

it('returns home after the last file closes', async () => {
  mocks.id = '0'
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot'
    ? { ...snapshot(), files: [snapshot().files[0]] }
    : command === 'close_document' ? { ...snapshot(1), files: [] } : other(command))
  await mount()
  await act(async () => button('Close first.md').click())
  expect(host.querySelectorAll('.native-file-pill')).toHaveLength(0)
  expect(mocks.navigate).toHaveBeenLastCalledWith('/')
})

it('keeps a file open and selects it when its save is blocked', async () => {
  mocks.id = '0'
  mocks.closeDocument.mockResolvedValue(false)
  await mount()
  await act(async () => button('Close second.md').click())
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'close_document')).toBe(false)
  expect(host.querySelectorAll('.native-file-pill')).toHaveLength(2)
  expect(host.textContent).toContain('The file changed again')
  expect(mocks.navigate).toHaveBeenLastCalledWith('/d/1')
  expect(host.inert).toBe(false)
})

it('coalesces close clicks, locks editing, and pauses activation while saving', async () => {
  let finish!: (value: boolean) => void
  mocks.closeDocument.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve }))
  await mount()
  await act(async () => { button('Close first.md').click(); button('Close second.md').click() })
  expect(mocks.closeDocument).toHaveBeenCalledTimes(1)
  expect(host.inert).toBe(true)
  mocks.invoke.mockClear()
  await poll()
  expect(mocks.invoke).not.toHaveBeenCalledWith('snapshot')
  await act(async () => finish(false))
  expect(host.inert).toBe(false)
})

it('retains the pill when the native close fails', async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'close_document') throw new Error('Native close failed')
    return command === 'snapshot' ? snapshot() : other(command)
  })
  await mount()
  await act(async () => button('Close first.md').click())
  expect(host.querySelectorAll('.native-file-pill')).toHaveLength(2)
  expect(host.textContent).toContain('Native close failed')
  expect(host.inert).toBe(false)
})

it('reserves the macOS window controls and keeps file buttons outside drag regions', async () => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  await mount()
  expect(host.querySelector('.native-titlebar-overlay')?.hasAttribute('data-tauri-drag-region')).toBe(true)
  expect(host.querySelector('.native-file-pills')?.hasAttribute('data-tauri-drag-region')).toBe(true)
  for (const item of host.querySelectorAll('button')) expect(item.hasAttribute('data-tauri-drag-region')).toBe(false)
  vi.restoreAllMocks()
})

it('keeps editing locked when quit arrives during a file close', async () => {
  let finishFile!: (value: boolean) => void
  let finishWindow!: (value: boolean) => void
  mocks.closeDocument.mockImplementation(() => new Promise<boolean>((resolve) => { finishFile = resolve }))
  mocks.prepareToClose.mockResolvedValueOnce(true).mockImplementation(() => new Promise<boolean>((resolve) => { finishWindow = resolve }))
  await mount()
  await act(async () => button('Close first.md').click())
  const quit = mocks.listen.mock.calls.find(([event]) => event === 'close-requested')![1] as () => void
  await act(async () => quit())
  expect(mocks.prepareToClose).toHaveBeenCalledTimes(1)
  await act(async () => finishFile(false))
  expect(mocks.prepareToClose).toHaveBeenCalledTimes(2)
  expect(host.inert).toBe(true)
  await act(async () => finishWindow(true))
  expect(host.inert).toBe(false)
  expect(mocks.invoke).toHaveBeenCalledWith('finish_close')
})

it.each([['MacIntel', '⌘O'], ['Win32', 'Ctrl+O']] as const)(
  'shows the native Open shortcut on %s', async (platform, shortcut) => {
    const platformSpy = vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
    mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot'
      ? { ...snapshot(), files: [] } : other(command))
    try {
      await mount()
      expect(button('Open Markdown files…').querySelector('.native-open-shortcut')?.textContent).toBe(shortcut)
    } finally { platformSpy.mockRestore() }
  },
)

it('waits for home departure only after admission, then changes screens without moving Open', async () => {
  const original = HTMLElement.prototype.animate
  const pending: { element: HTMLElement; finish: () => void }[] = []
  HTMLElement.prototype.animate = function () {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => { finish = resolve })
    pending.push({ element: this, finish })
    return { finished, cancel: finish } as unknown as Animation
  }
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot'
    ? { ...snapshot(), files: [] } : other(command))
  try {
    await mount()
    const open = button('Open Markdown files…')
    await act(async () => open.click())
    await poll()
    expect(pending).toHaveLength(0)
    mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot' ? snapshot(1, 0) : other(command))
    await poll()
    expect(pending).toHaveLength(3)
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(open.classList.contains('native-open-home')).toBe(true)
    await act(async () => pending.forEach((animation) => animation.finish()))
    expect(mocks.navigate).toHaveBeenLastCalledWith('/d/0')
    expect(open.classList.contains('native-open-home')).toBe(false)
    expect(pending).toHaveLength(4)
    expect(pending.every((animation) => animation.element !== open)).toBe(true)
    await act(async () => pending.forEach((animation) => animation.finish()))
    await poll()
    expect(pending).toHaveLength(4)
  } finally { HTMLElement.prototype.animate = original }
})

it.each([false, true])('fades the last file only if closing succeeds: %s', async (success) => {
  const original = HTMLElement.prototype.animate
  const pending: (() => void)[] = []
  HTMLElement.prototype.animate = function () {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => { finish = resolve })
    pending.push(finish)
    return { finished, cancel: finish } as unknown as Animation
  }
  mocks.id = '0'
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot'
    ? { ...snapshot(), files: [snapshot().files[0]] }
    : command === 'close_document' ? { ...snapshot(1), files: [] } : other(command))
  if (!success) mocks.closeDocument.mockResolvedValue(false)
  try {
    await mount()
    await act(async () => button('Close first.md').click())
    expect(pending).toHaveLength(success ? 1 : 0)
    expect(host.querySelectorAll('.native-file-pill')).toHaveLength(1)
    if (success) {
      expect(host.inert).toBe(true)
      await act(async () => pending[0]!())
      expect(mocks.navigate).toHaveBeenLastCalledWith('/')
      expect(host.querySelectorAll('.native-file-pill')).toHaveLength(0)
      expect(pending).toHaveLength(2)
    }
    expect(host.inert).toBe(false)
  } finally { HTMLElement.prototype.animate = original }
})


it('keeps the setup surface visible after closing the last file before setup completes', async () => {
  const original = HTMLElement.prototype.animate
  const faded: Element[] = []
  HTMLElement.prototype.animate = function (frames: Keyframe[]) {
    if (frames.at(-1)?.opacity === 0) faded.push(this)
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation
  }
  mocks.id = '0'
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot'
    ? { ...snapshot(), files: [snapshot().files[0]] }
    : command === 'setup_snapshot' ? { ...setup(), completed: false }
    : command === 'close_document' ? { ...snapshot(1), files: [] } : other(command))
  try {
    await mount()
    await act(async () => button('Close first.md').click())
    await poll()
    expect(mocks.navigate).toHaveBeenLastCalledWith('/')
    expect(host.querySelector('.native-setup')).not.toBeNull()
    expect(faded).toEqual([])
  } finally { HTMLElement.prototype.animate = original }
})

it('does not re-render the session tree when a poll returns an unchanged snapshot', async () => {
  await mount()
  const renders = mocks.appRenders
  await poll()
  await poll()
  expect(mocks.appRenders).toBe(renders)
  mocks.invoke.mockImplementation(async (command: string) => command === 'snapshot'
    ? snapshot(0, null, ['Missing /lost.md']) : other(command))
  await poll()
  expect(mocks.appRenders).toBeGreaterThan(renders)
})

it('disables native Find at home and forwards its menu event when a document is active', async () => {
  await mount()
  expect(mocks.invoke).toHaveBeenCalledWith('set_find_enabled', { enabled: false })
  mocks.id = '0'
  await mount()
  expect(mocks.invoke).toHaveBeenCalledWith('set_find_enabled', { enabled: true })
  const requests = useOverlay.getState().findRequest
  const listener = mocks.listen.mock.calls.find(([event]) => event === 'find-requested')![1]
  act(() => listener())
  expect(useOverlay.getState().findRequest).toBe(requests + 1)
})
