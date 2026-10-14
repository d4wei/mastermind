// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeHost, type NativeBridge } from '../ui/desktop/host'
import { installHost } from '../ui/app/host'
import { ApiError, getFile, getSession, putFile } from '../ui/app/api'
import { createCloseHandler } from '../ui/desktop/close'
import { DEFAULT_CONFIG } from '../ui/settings/defaults'
import { createDocStore } from '../ui/app/store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
afterEach(() => { installHost(null); vi.unstubAllGlobals() })

describe('native reviewer boundary', () => {
  it('uses native commands without issuing HTTP requests and retains conflict errors', async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'write_document') throw { status: 409, error: 'file_changed' }
      return args
    }) as NativeBridge['invoke']
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    installHost(createNativeHost({ invoke, listen: vi.fn() }, []))
    await expect(getSession('3')).resolves.toEqual({ id: '3' })
    await expect(getFile('3')).resolves.toEqual({ id: '3' })
    await expect(putFile('3', '文档\r\n', 'base')).rejects.toMatchObject({ status: 409 })
    await expect(putFile('3', '文档\r\n', 'base')).rejects.toBeInstanceOf(ApiError)
    expect(invoke).toHaveBeenCalledWith('write_document', { id: '3', content: '文档\r\n', baseVersion: 'base' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { status: 404, error: 'file_not_found', message: 'No such file or directory' },
    { status: 403, error: 'permission_denied', message: 'Permission denied' },
    { status: 409, error: 'file_changed', message: 'The file changed. Compare before saving.' },
    { status: 500, error: 'file_io_error', message: 'The disk operation failed' },
  ])('preserves structured recovery status and code while displaying the readable message: $error',
    async (failure) => {
      const invoke = vi.fn().mockRejectedValue(failure)
      const host = createNativeHost({ invoke, listen: vi.fn() }, [])
      await expect(host.getFile('0')).rejects.toMatchObject({
        status: failure.status, message: failure.message, data: failure,
      })
      await expect(host.putFile('0', 'local', 'base')).rejects.toBeInstanceOf(ApiError)
    })

  it.each([
    { status: 403, error: 'permission_denied', message: 'Permission denied', conflict: false },
    { status: 500, error: 'file_io_error', message: 'Disk operation failed', conflict: false },
    { status: 409, error: 'file_changed', message: 'Compare the current file', conflict: true },
  ])('retains dirty text and selects the existing recovery path for $error', async (failure) => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'document_meta') return {
        sessionId: '0', path: '/document.md', displayName: 'document.md',
      }
      if (command === 'read_document') return { content: 'original\r\n', mtimeMs: 1, version: 'base' }
      if (command === 'write_document') throw failure
    }) as NativeBridge['invoke']
    installHost(createNativeHost({ invoke, listen: vi.fn() }, []))
    const store = createDocStore()
    await store.getState().load('0')
    store.getState().setSourceFromEditor('local\n')
    expect(await store.getState().autosave()).toBe(false)
    expect(store.getState()).toMatchObject({
      source: 'local\n', savedSource: 'original\n', version: 'base',
      saving: false, conflict: failure.conflict,
    })
    expect(invoke).toHaveBeenCalledWith('write_document', {
      id: '0', content: 'local\r\n', baseVersion: 'base',
    })
    expect(store.getState().notice).toEqual(failure.conflict ? null : {
      kind: 'error', msg: 'saveFailed',
    })
  })

  it('does not leak a subscription that completes after document navigation', async () => {
    const subscribed = deferred<() => void>()
    const stop = vi.fn()
    const invoke = vi.fn()
    const host = createNativeHost({ invoke, listen: () => subscribed.promise }, [])
    const events = host.events('0')
    events.close()
    subscribed.resolve(stop)
    await subscribed.promise
    expect(stop).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('revalidates after watcher registration and ignores invalidations after close', async () => {
    let invalidate!: () => void
    const bridge: NativeBridge = {
      invoke: vi.fn().mockResolvedValue(undefined),
      listen: async (_, handler) => { invalidate = handler; return vi.fn<() => void>() },
    }
    const events = createNativeHost(bridge, []).events('0')
    const listener = vi.fn()
    events.addEventListener('file-changed', listener)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    expect(bridge.invoke).toHaveBeenCalledWith('watch_document', { id: '0' })
    invalidate()
    expect(listener).toHaveBeenCalledTimes(2)
    events.close()
    invalidate()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('serializes preference patches so concurrent controls do not erase each other', async () => {
    let saved: Record<string, unknown> | null = null
    const bridge: NativeBridge = {
      invoke: vi.fn(async (command, args) => {
        if (command === 'read_preferences') return saved
        saved = { ...saved, ...args!.patch as Record<string, unknown> }
      }) as NativeBridge['invoke'],
      listen: vi.fn(),
    }
    const host = createNativeHost(bridge, [])
    expect(await host.config()).toEqual(DEFAULT_CONFIG)
    await Promise.all([host.updateConfig({ authorTag: 'Alex' }), host.updateConfig({ uiLang: 'zh-CN' })])
    expect(await host.config()).toMatchObject({ authorTag: 'Alex', uiLang: 'zh-CN' })
    expect(saved).toEqual({ authorTag: 'Alex', uiLang: 'zh-CN' })
    expect(bridge.invoke).toHaveBeenCalledWith('write_preferences', { patch: { authorTag: 'Alex' } })
    expect(bridge.invoke).toHaveBeenCalledWith('write_preferences', { patch: { uiLang: 'zh-CN' } })
  })
})

it('native close waits, locks editing, and coalesces repeated close requests', async () => {
  const saved = deferred<boolean>()
  const finish = vi.fn().mockResolvedValue(undefined)
  const lock = vi.fn()
  const blocked = vi.fn()
  const close = createCloseHandler({ prepareToClose: () => saved.promise }, finish, lock, blocked)
  const pending = close()
  await close()
  expect(lock).toHaveBeenCalledExactlyOnceWith(true)
  expect(finish).not.toHaveBeenCalled()
  saved.resolve(true)
  await pending
  expect(finish).toHaveBeenCalledOnce()
  expect(blocked).not.toHaveBeenCalled()
  expect(lock).toHaveBeenLastCalledWith(false)
})

it.each([false, new Error('save failed')])('native close retains the window on unresolved work: %s', async (result) => {
  const finish = vi.fn()
  const lock = vi.fn()
  const blocked = vi.fn()
  const close = createCloseHandler({ prepareToClose: async () => {
    if (result instanceof Error) throw result
    return result
  } }, finish, lock, blocked)
  await close()
  expect(finish).not.toHaveBeenCalled()
  expect(blocked).toHaveBeenCalledOnce()
  expect(lock).toHaveBeenLastCalledWith(false)
})

it('waits for native termination cancellation before unlocking or accepting another close', async () => {
  const cancelled = deferred<void>()
  const blocked = vi.fn(() => cancelled.promise)
  const lock = vi.fn()
  const finish = vi.fn().mockRejectedValue(new Error('exit unavailable'))
  const close = createCloseHandler({ prepareToClose: async () => true }, finish, lock, blocked)
  const pending = close()
  await vi.waitFor(() => expect(blocked).toHaveBeenCalledOnce())
  await close()
  expect(lock).toHaveBeenCalledExactlyOnceWith(true)
  expect(finish).toHaveBeenCalledOnce()
  cancelled.resolve()
  await pending
  expect(lock).toHaveBeenLastCalledWith(false)
  await close()
  expect(finish).toHaveBeenCalledTimes(2)
})

it('falls back to bounded periodic invalidation when watcher registration fails', async () => {
  vi.useFakeTimers()
  try {
    const stop = vi.fn()
    const events = createNativeHost({ invoke: vi.fn().mockRejectedValue('watch unavailable'),
      listen: async () => stop }, []).events('0')
    const listener = vi.fn()
    events.addEventListener('file-changed', listener)
    await vi.advanceTimersByTimeAsync(0)
    expect(listener).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(listener).toHaveBeenCalledTimes(2)
    events.close()
    await vi.advanceTimersByTimeAsync(1000)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})

it('revalidates a silent healthy watcher while native events still arrive immediately', async () => {
  vi.useFakeTimers()
  try {
    let invalidate!: () => void
    const stop = vi.fn()
    const events = createNativeHost({ invoke: vi.fn().mockResolvedValue(undefined),
      listen: async (_, callback) => { invalidate = callback; return stop } }, []).events('0')
    const listener = vi.fn()
    events.addEventListener('file-changed', listener)
    await vi.advanceTimersByTimeAsync(0)
    expect(listener).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4999)
    expect(listener).toHaveBeenCalledTimes(1)
    invalidate()
    expect(listener).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(listener).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(5000)
    expect(listener).toHaveBeenCalledTimes(4)
    events.close()
    expect(stop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    invalidate()
    await vi.advanceTimersByTimeAsync(10000)
    expect(listener).toHaveBeenCalledTimes(4)
  } finally { vi.useRealTimers() }
})

it.each(['resolve', 'reject'] as const)(
  'does not start a timer when watcher registration %ss after close', async (outcome) => {
    vi.useFakeTimers()
    try {
      let resolve!: () => void
      let reject!: (reason: unknown) => void
      const registration = new Promise<void>((done, fail) => { resolve = done; reject = fail })
      const stop = vi.fn()
      const invoke = vi.fn().mockReturnValue(registration)
      const events = createNativeHost({ invoke, listen: async () => stop }, []).events('0')
      const listener = vi.fn()
      events.addEventListener('file-changed', listener)
      await vi.advanceTimersByTimeAsync(0)
      expect(invoke).toHaveBeenCalledWith('watch_document', { id: '0' })
      events.close()
      if (outcome === 'resolve') resolve()
      else reject(new Error('watch unavailable'))
      await vi.advanceTimersByTimeAsync(10000)
      expect(listener).not.toHaveBeenCalled()
      expect(stop).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  },
)

it('does not install fallback polling when subscription fails after close', async () => {
  vi.useFakeTimers()
  try {
    let reject!: (reason: unknown) => void
    const subscription = new Promise<() => void>((_, fail) => { reject = fail })
    const events = createNativeHost({ invoke: vi.fn(), listen: () => subscription }, []).events('0')
    const listener = vi.fn()
    events.addEventListener('file-changed', listener)
    events.close()
    reject(new Error('events unavailable'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(listener).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})


it.each([
  { watchFails: false, readFails: false, interval: 5000 },
  { watchFails: false, readFails: true, interval: 5000 },
  { watchFails: true, readFails: false, interval: 1000 },
  { watchFails: true, readFails: true, interval: 1000 },
])('pauses periodic invalidation during a read ($watchFails, $readFails)', async ({ watchFails, readFails, interval }) => {
  vi.useFakeTimers()
  try {
    let finishRead!: () => void
    let failRead!: (error: unknown) => void
    const read = new Promise<void>((resolve, reject) => { finishRead = resolve; failRead = reject })
    let invalidate!: () => void
    const invoke = vi.fn((command: string) => {
      if (command === 'read_document') return read
      return watchFails ? Promise.reject('watch unavailable') : Promise.resolve()
    }) as NativeBridge['invoke']
    const host = createNativeHost({ invoke, listen: async (_, callback) => {
      invalidate = callback
      return () => {}
    } }, [])
    const events = host.events('0')
    const listener = vi.fn()
    events.addEventListener('file-changed', listener)
    await vi.advanceTimersByTimeAsync(0)
    expect(listener).toHaveBeenCalledOnce()
    const pendingRead = host.getFile('0').catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(interval * 3)
    expect(listener).toHaveBeenCalledOnce()
    invalidate()
    expect(listener).toHaveBeenCalledTimes(2)
    if (readFails) failRead(new Error('read unavailable'))
    else finishRead()
    await pendingRead
    await vi.advanceTimersByTimeAsync(interval)
    expect(listener).toHaveBeenCalledTimes(3)
    events.close()
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})

it('another document read does not suppress the active document backstop', async () => {
  vi.useFakeTimers()
  try {
    const read = deferred<void>()
    const invoke = vi.fn((command: string) => command === 'read_document'
      ? read.promise : Promise.resolve()) as NativeBridge['invoke']
    const host = createNativeHost({ invoke, listen: async () => () => {} }, [])
    const events = host.events('0')
    const listener = vi.fn()
    events.addEventListener('file-changed', listener)
    await vi.advanceTimersByTimeAsync(0)
    const pendingRead = host.getFile('1')
    await vi.advanceTimersByTimeAsync(5000)
    expect(listener).toHaveBeenCalledTimes(2)
    read.resolve()
    await pendingRead
    events.close()
  } finally { vi.useRealTimers() }
})

it('waits for all concurrent reads of one document before periodic invalidation resumes', async () => {
  vi.useFakeTimers()
  try {
    const first = deferred<void>()
    const second = deferred<void>()
    const invoke = vi.fn().mockResolvedValue(undefined)
    const host = createNativeHost({ invoke, listen: async () => () => {} }, [])
    const events = host.events('0')
    const listener = vi.fn()
    events.addEventListener('file-changed', listener)
    await vi.advanceTimersByTimeAsync(0)
    invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const firstRead = host.getFile('0')
    const secondRead = host.getFile('0')
    first.resolve()
    await firstRead
    await vi.advanceTimersByTimeAsync(5000)
    expect(listener).toHaveBeenCalledOnce()
    second.resolve()
    await secondRead
    await vi.advanceTimersByTimeAsync(5000)
    expect(listener).toHaveBeenCalledTimes(2)
    events.close()
  } finally { vi.useRealTimers() }
})
