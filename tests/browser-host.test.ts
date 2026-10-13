import { afterEach, expect, it, vi } from 'vitest'
import { createBrowserHost } from '../src/ui/app/browserHost'
import { ApiError } from '../src/ui/app/api'

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
    json: async () => ({ error: 'changed', version: 'disk' }) }))
  await expect(createBrowserHost().putFile('preview', 'accepted', 'base')).rejects.toMatchObject({
    status: 409, data: { error: 'changed', version: 'disk' },
  } satisfies Partial<ApiError>)
})
it('reports non-JSON host failures as status-bearing API errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable',
    json: async () => { throw new SyntaxError('invalid JSON') } }))
  await expect(createBrowserHost().getFile('preview')).rejects.toMatchObject({ status: 503, message: 'Unavailable' })
})
it('propagates malformed successful responses', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true,
    json: async () => { throw new SyntaxError('invalid JSON') } }))
  await expect(createBrowserHost().getFile('preview')).rejects.toThrow('invalid JSON')
})
