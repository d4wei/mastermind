import type { BrowserInfo, ClientConfig, FileResponse, SessionMeta, ThemeInfo } from '../../shared/types'

export interface DocumentEvents {
  addEventListener(name: string, listener: (event: MessageEvent) => void): void
  close(): void
}

export interface ReviewerHost {
  getSession(id: string): Promise<SessionMeta>
  getFile(id: string): Promise<FileResponse>
  putFile(id: string, content: string, baseVersion: string): Promise<{ mtimeMs: number; version: string }>
  rename(id: string, filename: string): Promise<{ path: string; displayName: string; version: string }>
  events(id: string): DocumentEvents
  translation(id: string, targetLang: string): Promise<unknown>
  config(): Promise<ClientConfig>
  updateConfig(patch: Partial<Omit<ClientConfig, 'version'>>): Promise<ClientConfig>
  themes(): Promise<ThemeInfo[]>
  browsers(): Promise<BrowserInfo[]>
}

let installed: ReviewerHost | null = null

// A native entry point installs its host before mounting any document or preference store.
export function installHost(host: ReviewerHost | null): void { installed = host }
export function reviewerHost(): ReviewerHost | null { return installed }
