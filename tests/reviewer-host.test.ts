import { afterEach, expect, it, vi } from 'vitest'
import { getFile } from '../ui/app/api'
import { installHost } from '../ui/app/host'
import { useConfig } from '../ui/app/configStore'

afterEach(() => { installHost(null); vi.unstubAllGlobals() })
it('requires an installed host instead of falling back to HTTP', async () => {
  installHost(null)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  expect(() => getFile('preview')).toThrow('Reviewer host is not installed')
  await expect(useConfig.getState().load()).rejects.toThrow('Reviewer host is not installed')
  await expect(useConfig.getState().update({ uiLang: 'en' })).rejects.toThrow('Reviewer host is not installed')
  expect(fetch).not.toHaveBeenCalled()
})
