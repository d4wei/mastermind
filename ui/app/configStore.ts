import { requireReviewerHost } from './host'
import { create } from 'zustand'
import type { ClientConfig } from '../settings/types'
import type { ThemeInfo } from '../../themes/types'

export type ConfigPatch = Partial<Omit<ClientConfig, 'version'>>

interface ConfigState {
  config: ClientConfig | null
  themes: ThemeInfo[]
  load(): Promise<void>
  update(patch: ConfigPatch): Promise<void>
}

export const useConfig = create<ConfigState>((set, get) => ({
  config: null,
  themes: [],

  async load() {
    const [config, themes] = await Promise.all([
      requireReviewerHost().config(),
      requireReviewerHost().themes(),
    ])
    set({ config, themes })
  },

  async update(patch) {
    const host = requireReviewerHost()
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
      const { useDoc } = await import('./store')
      useDoc.getState().setNotice({ kind: 'error', msg: 'configSaveFailed' })
    }
  },
}))
