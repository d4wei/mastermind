import { reviewerHost, type DocumentEvents } from './host'
import type { FileResponse, SessionMeta } from '../../shared/types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let detail = res.statusText
    let data: unknown
    try {
      const j = (await res.json()) as { error?: string }
      data = j
      if (j.error) detail = j.error
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, detail, data)
  }
  return (await res.json()) as T
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

export function getSession(sessionId: string): Promise<SessionMeta> {
  if (reviewerHost()) return reviewerHost()!.getSession(sessionId)
  return request<SessionMeta>(`/api/sessions/${sessionId}`)
}

export function getFile(sessionId: string): Promise<FileResponse> {
  if (reviewerHost()) return reviewerHost()!.getFile(sessionId)
  return request<FileResponse>(`/api/sessions/${sessionId}/file`)
}

export function putFile(sessionId: string, content: string, baseVersion: string): Promise<{ mtimeMs: number; version: string }> {
  if (reviewerHost()) return reviewerHost()!.putFile(sessionId, content, baseVersion)
  return request<{ mtimeMs: number; version: string }>(`/api/sessions/${sessionId}/file`, jsonInit('PUT', { content, baseVersion }))
}

export function postRename(sessionId: string, filename: string): Promise<{ path: string; displayName: string; version: string }> {
  if (reviewerHost()) return reviewerHost()!.rename(sessionId, filename)
  return request<{ path: string; displayName: string; version: string }>(
    `/api/sessions/${sessionId}/rename`,
    jsonInit('POST', { filename }),
  )
}

export function openEvents(sessionId: string): DocumentEvents {
  if (reviewerHost()) return reviewerHost()!.events(sessionId)
  return new EventSource(`/api/sessions/${sessionId}/events?role=ui`)
}

export function getPreparedTranslation(sessionId: string, targetLang: string): Promise<unknown> {
  if (reviewerHost()) return reviewerHost()!.translation(sessionId, targetLang)
  return request<unknown>(`/api/sessions/${sessionId}/translation?targetLang=${encodeURIComponent(targetLang)}`)
}
