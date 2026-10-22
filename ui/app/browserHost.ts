import { HostError, type HostFailure, type ReviewerHost } from './host'

function failureKind(status: number, code?: string): HostFailure {
  return status === 409 ? 'conflict' : status === 404 || status === 410 ? 'missing'
    : code === 'not_utf8' ? 'notUtf8' : 'failure'
}

export function createBrowserHost(): ReviewerHost {
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(path, { method, ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }) })
    let data: unknown
    try { data = await response.json() }
    catch (error) {
      if (!response.ok) throw new HostError(failureKind(response.status), response.statusText)
      throw error
    }
    if (!response.ok) {
      const code = data && typeof data === 'object' && 'error' in data ? String(data.error) : undefined
      throw new HostError(failureKind(response.status, code), code ?? response.statusText, data)
    }
    return data as T
  }
  const session = (id: string) => `/api/sessions/${encodeURIComponent(id)}`
  return {
    getSession: (id) => request(session(id)),
    getFile: (id) => request(`${session(id)}/file`),
    putFile: (id, content, baseVersion) => request(`${session(id)}/file`, 'PUT', { content, baseVersion }),
    subscribe(id, listener) {
      const events = new EventSource(`${session(id)}/events`)
      events.addEventListener('file-changed', () => listener('changed'))
      events.addEventListener('file-deleted', () => listener('deleted'))
      events.addEventListener('translations-changed', () => listener('translations'))
      return () => events.close()
    },
    translations: (id) => request(`${session(id)}/translations`),
    translation: (id, lang) => request(`${session(id)}/translation?targetLang=${encodeURIComponent(lang)}`),
    config: () => request('/api/config'),
    updateConfig: (patch) => request('/api/config', 'PUT', patch),
    themes: () => request('/api/themes'),
  }
}
