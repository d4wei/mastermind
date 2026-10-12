import { reviewerHost } from './host'
import { create } from 'zustand'
import type { BrowserInfo, ClientConfig, ThemeInfo } from '../../shared/types'

export type ConfigPatch = Partial<Omit<ClientConfig, 'version'>>

interface ConfigState {
  config: ClientConfig | null
  themes: ThemeInfo[]
  browsers: BrowserInfo[]
  load(): Promise<void>
  update(patch: ConfigPatch): Promise<void>
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return (await res.json()) as T
}

export const useConfig = create<ConfigState>((set, get) => ({
  config: null,
  themes: [],
  browsers: [],

  async load() {
    const [config, themes, browsers] = await Promise.all([
      reviewerHost()?.config() ?? fetchJson<ClientConfig>('/api/config'),
      reviewerHost()?.themes() ?? fetchJson<ThemeInfo[]>('/api/themes'),
      (reviewerHost()?.browsers() ?? fetchJson<BrowserInfo[]>('/api/browsers')).catch(() => []),
    ])
    set({ config, themes, browsers })
  },

  async update(patch) {
    const current = get().config
    if (current) {
      set({ config: { ...current, ...patch } as ClientConfig })
    }
    try {
      const config = await (reviewerHost()?.updateConfig(patch) ?? fetchJson<ClientConfig>('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }))
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
