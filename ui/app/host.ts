import type { FileResponse, SessionMeta } from './hostTypes'
import type { ClientConfig } from '../settings/types'
import type { ThemeInfo } from '../../themes/types'

export type HostFailure = 'conflict' | 'missing' | 'failure'
export type HostInvalidation = 'changed' | 'deleted' | 'config'

export class HostError extends Error {
  constructor(public kind: HostFailure, message: string, public data?: unknown) {
    super(message)
  }
}

export interface ReviewerHost {
  getSession(id: string): Promise<SessionMeta>
  getFile(id: string): Promise<FileResponse>
  putFile(id: string, content: string, baseVersion: string): Promise<{ mtimeMs: number; version: string }>
  subscribe(id: string, listener: (event: HostInvalidation) => void): () => void
  translation(id: string, targetLang: string): Promise<unknown>
  config(): Promise<ClientConfig>
  updateConfig(patch: Partial<Omit<ClientConfig, 'version'>>): Promise<ClientConfig>
  themes(): Promise<ThemeInfo[]>
}

let installed: ReviewerHost | null = null

// Each entry point installs its host before mounting any document or preference store.
export function installHost(host: ReviewerHost | null): void { installed = host }
export function reviewerHost(): ReviewerHost | null { return installed }

export function requireReviewerHost(): ReviewerHost {
  if (!installed) throw new Error('Reviewer host is not installed; install a host before mounting the reviewer')
  return installed
}
