import { requireReviewerHost } from './host'
import { create } from 'zustand'
import type { ClientConfig } from '../settings/types'
import type { ThemeInfo } from '../../themes/types'

export type ConfigPatch = Partial<Omit<ClientConfig, 'version'>>

interface ConfigState {
  config: ClientConfig | null
  themes: ThemeInfo[]
  saveFailed: boolean
  clearFailure(): void
  load(): Promise<void>
  update(patch: ConfigPatch): Promise<void>
}

export const useConfig = create<ConfigState>((set, get) => ({
  config: null,
  themes: [],
  saveFailed: false,
  clearFailure() { set({ saveFailed: false }) },

  async load() {
    const [config, themes] = await Promise.all([
      requireReviewerHost().config(),
      requireReviewerHost().themes(),
    ])
    set({ config, themes })
  },

  async update(patch) {
    const host = requireReviewerHost()
    set({ saveFailed: false })
    const current = get().config
    if (current) {
      set({ config: { ...current, ...patch } as ClientConfig })
    }
    try {
      const config = await host.updateConfig(patch)
      set({ config })
    } catch {
      await get()
        .load()
        .catch(() => {})
      set({ saveFailed: true })
    }
  },
}))
