import { useEffect, useState } from 'react'

// Parsing stays DOM-free; navigation and the hook touch `window` only when called.

type Route = { kind: 'home' } | { kind: 'doc'; sessionId: string }

const DOC_RE = /^\/d\/([0-9a-f-]+)\/?$/i

export function parseRoute(pathname: string): Route {
  const doc = DOC_RE.exec(pathname)
  return doc ? { kind: 'doc', sessionId: doc[1]! } : { kind: 'home' }
}

/** SPA navigation: push a path and notify listeners (popstate covers back/forward). */
export function navigate(to: string): void {
  if (to === window.location.pathname) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname))
  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return route
}
