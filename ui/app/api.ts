import { requireReviewerHost, type DocumentEvents } from './host'
import type { FileResponse, SessionMeta } from './hostTypes'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message)
  }
}

export function getSession(sessionId: string): Promise<SessionMeta> {
  return requireReviewerHost().getSession(sessionId)
}
export function getFile(sessionId: string): Promise<FileResponse> {
  return requireReviewerHost().getFile(sessionId)
}
export function putFile(sessionId: string, content: string, baseVersion: string): Promise<{ mtimeMs: number; version: string }> {
  return requireReviewerHost().putFile(sessionId, content, baseVersion)
}
export function openEvents(sessionId: string): DocumentEvents {
  return requireReviewerHost().events(sessionId)
}
export function getPreparedTranslation(sessionId: string, targetLang: string): Promise<unknown> {
  return requireReviewerHost().translation(sessionId, targetLang)
}
