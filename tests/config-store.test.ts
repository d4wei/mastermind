import { afterEach, expect, it, vi } from 'vitest'
import { installHost } from '../ui/app/host'
import { useConfig } from '../ui/app/configStore'
import { DEFAULT_CONFIG } from '../ui/settings/defaults'
import { fakeHost } from './helpers/host'

const initial = useConfig.getState()
afterEach(() => { installHost(null); useConfig.setState(initial) })

it('loads preferences and themes from the installed host', async () => {
  const config = vi.fn().mockResolvedValue(DEFAULT_CONFIG)
  const themes = vi.fn().mockResolvedValue([])
  installHost(fakeHost({ config, themes }))
  await useConfig.getState().load()
  expect(useConfig.getState()).toMatchObject({ config: DEFAULT_CONFIG, themes: [] })
  expect(config).toHaveBeenCalledOnce()
  expect(themes).toHaveBeenCalledOnce()
})

it('owns save failure feedback and restores persisted preferences before retry', async () => {
  const updateConfig = vi.fn().mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue({ ...DEFAULT_CONFIG, fontSize: 19 })
  installHost(fakeHost({ config: async () => DEFAULT_CONFIG, themes: async () => [], updateConfig }))
  await useConfig.getState().load()
  await useConfig.getState().update({ fontSize: 18 })
  expect(useConfig.getState()).toMatchObject({ config: DEFAULT_CONFIG, saveFailed: true })
  await useConfig.getState().update({ fontSize: 19 })
  expect(useConfig.getState()).toMatchObject({ config: { fontSize: 19 }, saveFailed: false })
})
