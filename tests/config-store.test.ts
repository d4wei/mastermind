import { createBrowserHost } from '../src/ui/app/browserHost'
import { installHost } from '../src/ui/app/host'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConfig } from '../src/ui/app/configStore'

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn((url: string) => {
    if (url in routes) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(routes[url]) } as Response)
    }
    // unknown route → 404 (mimics an older daemon without /api/browsers)
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response)
  })
}

beforeEach(() => installHost(createBrowserHost()))

afterEach(() => {
  installHost(null)
  vi.unstubAllGlobals()
  useConfig.setState({ config: null, themes: [] })
})

describe('configStore.load resilience', () => {
  it('loads config and themes without requesting a browser chooser', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/config': { version: 1, theme: 'grid', translationLanguage: null, browser: '' },
        '/api/themes': [{ id: 'grid', name: 'Grid' }],
        // '/api/browsers' intentionally absent → 404
      }),
    )
    await useConfig.getState().load()
    const s = useConfig.getState()
    expect(s.config).not.toBeNull()
    expect(s.config!.theme).toBe('grid')
    expect(s.themes).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/api/config', '/api/themes'])
  })

})
