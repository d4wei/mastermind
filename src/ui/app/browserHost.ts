import { ApiError } from './api'
import type { ReviewerHost } from './host'

export function createBrowserHost(): ReviewerHost {
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(path, { method, ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }) })
    let data: unknown
    try { data = await response.json() }
    catch (error) {
      if (!response.ok) throw new ApiError(response.status, response.statusText)
      throw error
    }
    if (!response.ok) {
      const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : response.statusText
      throw new ApiError(response.status, message, data)
    }
    return data as T
  }
  const session = (id: string) => `/api/sessions/${encodeURIComponent(id)}`
  return {
    getSession: (id) => request(session(id)),
    getFile: (id) => request(`${session(id)}/file`),
    putFile: (id, content, baseVersion) => request(`${session(id)}/file`, 'PUT', { content, baseVersion }),
    events: (id) => new EventSource(`${session(id)}/events?role=ui`),
    translation: (id, lang) => request(`${session(id)}/translation?targetLang=${encodeURIComponent(lang)}`),
    config: () => request('/api/config'),
    updateConfig: (patch) => request('/api/config', 'PUT', patch),
    themes: () => request('/api/themes'),
  }
}
