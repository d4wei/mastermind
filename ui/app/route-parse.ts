export type Route = { kind: 'home' } | { kind: 'doc'; sessionId: string }

const DOC_RE = /^\/d\/(preview|[0-9a-f-]+)\/?$/i

export function parseRoute(pathname: string): Route {
  const doc = DOC_RE.exec(pathname)
  return doc ? { kind: 'doc', sessionId: doc[1]! } : { kind: 'home' }
}
