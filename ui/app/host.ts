import type { ClientConfig } from '../settings/types'
import type { ThemeInfo } from '../../themes/types'

export interface SessionMeta {
  sessionId: string
  path: string
  displayName: string
}

export interface FileResponse {
  content: string
  mtimeMs: number
  version: string
  /** True when the bytes are not valid UTF-8 and `content` is their lossy decoding; absent reads as false. */
  lossy?: boolean
}

const HOST_FAILURES = ['conflict', 'missing', 'notUtf8', 'failure'] as const
/** `notUtf8` is a refused write to a file whose bytes are not valid UTF-8. */
export type HostFailure = typeof HOST_FAILURES[number]
type HostInvalidation = 'changed' | 'deleted' | 'translations'

export class HostError extends Error {
  constructor(public kind: HostFailure, message: string, public data?: unknown) {
    super(message)
  }
}

/** Both hosts serialize a failure's `kind`; an absent or unknown kind is a plain failure. */
export function failureKind(error: unknown): HostFailure {
  const kind = error && typeof error === 'object' && 'kind' in error ? error.kind : undefined
  return HOST_FAILURES.find((known) => known === kind) ?? 'failure'
}

export interface ReviewerHost {
  getSession(id: string): Promise<SessionMeta>
  getFile(id: string): Promise<FileResponse>
  putFile(id: string, content: string, baseVersion: string): Promise<{ version: string }>
  saveCopy?(id: string, content: string, forClose?: boolean): Promise<{ meta: SessionMeta; file: FileResponse } | null>
  subscribe(id: string, listener: (event: HostInvalidation) => void): () => void
  translations(id: string): Promise<unknown[]>
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
