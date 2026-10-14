export interface SessionMeta {
  sessionId: string
  path: string
  displayName: string
  mtimeMs: number
}

export interface FileResponse {
  content: string
  mtimeMs: number
  version: string
}

