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

