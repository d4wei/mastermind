import type { FileResponse, SessionMeta } from './hostTypes'
import type { ClientConfig } from '../settings/types'
import type { ThemeInfo } from '../../themes/types'

export type HostFailure = 'conflict' | 'missing' | 'failure'
type HostInvalidation = 'changed' | 'deleted' | 'config' | 'translations'

export class HostError extends Error {
  constructor(public kind: HostFailure, message: string, public data?: unknown) {
    super(message)
  }
}

export interface ReviewerHost {
  getSession(id: string): Promise<SessionMeta>
  getFile(id: string): Promise<FileResponse>
  putFile(id: string, content: string, baseVersion: string): Promise<{ mtimeMs: number; version: string }>
  saveCopy?(id: string, content: string, forClose?: boolean): Promise<{ meta: SessionMeta; file: FileResponse } | null>
  subscribe(id: string, listener: (event: HostInvalidation) => void): () => void
  translations(id: string): Promise<unknown[]>
  translation(id: string, targetLang: string): Promise<unknown>
  config(): Promise<ClientConfig>
  updateConfig(patch: Partial<Omit<ClientConfig, 'version'>>): Promise<ClientConfig>
  themes(): Promise<ThemeInfo[]>
  setAppearance?(color: [number, number, number, number], appearance: ThemeInfo['appearance']): Promise<void>
}

let installed: ReviewerHost | null = null

// Each entry point installs its host before mounting any document or preference store.
export function installHost(host: ReviewerHost | null): void { installed = host }
export function reviewerHost(): ReviewerHost | null { return installed }

export function requireReviewerHost(): ReviewerHost {
  if (!installed) throw new Error('Reviewer host is not installed; install a host before mounting the reviewer')
  return installed
}
