import { afterEach, expect, it, vi } from 'vitest'
import { createBrowserHost } from '../ui/app/browserHost'
import { HostError } from '../ui/app/host'

afterEach(() => vi.unstubAllGlobals())
it('sends versioned accepted source through the development host adapter', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 'next', mtimeMs: 2 }) })
  vi.stubGlobal('fetch', fetchMock)
  await expect(createBrowserHost().putFile('preview', 'accepted\r\n', 'base')).resolves.toEqual({ version: 'next', mtimeMs: 2 })
  expect(fetchMock).toHaveBeenCalledWith('/api/sessions/preview/file', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'accepted\r\n', baseVersion: 'base' }),
  })
})
it('retains structured conflict responses for the document store', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409,
    json: async () => ({ error: 'changed', kind: 'conflict', version: 'disk' }) }))
  await expect(createBrowserHost().putFile('preview', 'accepted', 'base')).rejects.toMatchObject({
    kind: 'conflict', data: { error: 'changed', kind: 'conflict', version: 'disk' },
  } satisfies Partial<HostError>)
})
it('distinguishes a refused write to a file that is not valid UTF-8', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422,
    json: async () => ({ error: 'not_utf8', kind: 'notUtf8', message: 'The file is not valid UTF-8.' }) }))
  await expect(createBrowserHost().putFile('preview', 'accepted', 'base')).rejects.toMatchObject({ kind: 'notUtf8' })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: 'other' }) }))
  await expect(createBrowserHost().putFile('preview', 'accepted', 'base')).rejects.toMatchObject({ kind: 'failure' })
})
it('reads the failure kind from the error body rather than the HTTP status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 410,
    json: async () => ({ error: 'file unreadable', kind: 'missing' }) }))
  await expect(createBrowserHost().getFile('preview')).rejects.toMatchObject({ kind: 'missing' })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'invalid' }) }))
  await expect(createBrowserHost().translation('preview', 'fr')).rejects.toMatchObject({ kind: 'failure' })
})
it('reports non-JSON host failures as structured host failures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable',
    json: async () => { throw new SyntaxError('invalid JSON') } }))
  await expect(createBrowserHost().getFile('preview')).rejects.toMatchObject({ kind: 'failure', message: 'Unavailable' })
})
it('propagates malformed successful responses', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true,
    json: async () => { throw new SyntaxError('invalid JSON') } }))
  await expect(createBrowserHost().getFile('preview')).rejects.toThrow('invalid JSON')
})

it('adapts SSE names to invalidations and closes the connection', () => {
  const listeners = new Map<string, () => void>()
  const close = vi.fn()
  const urls: string[] = []
  vi.stubGlobal('EventSource', class {
    constructor(url: string) { urls.push(url) }
    addEventListener(name: string, listener: () => void) { listeners.set(name, listener) }
    close = close
  })
  const listener = vi.fn()
  const unsubscribe = createBrowserHost().subscribe('preview', listener)
  expect(urls).toEqual(['/api/sessions/preview/events'])
  expect([...listeners.keys()].sort()).toEqual(['file-changed', 'file-deleted', 'translations-changed'])
  listeners.get('file-changed')!()
  listeners.get('file-deleted')!()
  listeners.get('translations-changed')!()
  expect(listener.mock.calls).toEqual([['changed'], ['deleted'], ['translations']])
  unsubscribe()
  expect(close).toHaveBeenCalledOnce()
})
