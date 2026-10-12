// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeHost, type NativeBridge } from '../src/ui/native/host'
import { installHost } from '../src/ui/app/host'
import { ApiError, getFile, getSession, putFile } from '../src/ui/app/api'
import { createCloseHandler } from '../src/ui/native/close'
import { DEFAULT_CONFIG } from '../src/shared/config'

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
    let saved: unknown = null
    const bridge: NativeBridge = {
      invoke: vi.fn(async (command, args) => {
        if (command === 'read_preferences') return saved
        saved = args!.config
      }) as NativeBridge['invoke'],
      listen: vi.fn(),
    }
    const host = createNativeHost(bridge, [])
    expect(await host.config()).toEqual(DEFAULT_CONFIG)
    await Promise.all([host.updateConfig({ authorTag: 'Alex' }), host.updateConfig({ uiLang: 'zh-CN' })])
    expect(await host.config()).toMatchObject({ authorTag: 'Alex', uiLang: 'zh-CN' })
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

it('falls back to bounded periodic invalidation when watcher registration fails', async () => {
  vi.useFakeTimers()
  try {
    const events = createNativeHost({ invoke: vi.fn().mockRejectedValue('watch unavailable'),
      listen: async () => () => {} }, []).events('0')
    const listener = vi.fn()
    events.addEventListener('file-changed', listener)
    await vi.advanceTimersByTimeAsync(0)
    expect(listener).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(listener).toHaveBeenCalledTimes(2)
    events.close()
    await vi.advanceTimersByTimeAsync(1000)
    expect(listener).toHaveBeenCalledTimes(2)
  } finally { vi.useRealTimers() }
})
