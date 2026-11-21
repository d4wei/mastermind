import { act } from 'react'
import type { Root } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, vi } from 'vitest'
import { installHost } from '../../ui/app/host'
import { SessionView } from '../../ui/app/SessionView'
import { useDoc } from '../../ui/documents/store'
import { useTranslation } from '../../ui/translate/translationStore'
import { createReactHost, removeReactHost } from './dom'
import { fakeHost } from './host'

/**
 * Registers hooks that mount a document view of session `A` in a fresh jsdom host for each test,
 * with a default fake host and the browser globals the view reads, and restore the stores after.
 * Mock `ui/app/ConflictPanel` in the calling file, as `vi.mock` applies per file.
 */
export function readingSession() {
  const initial = useDoc.getState()
  let mounted: { host: HTMLDivElement; root: Root } | null = null
  beforeEach(() => {
    installHost(fakeHost())
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    mounted = createReactHost()
  })
  afterEach(() => {
    removeReactHost(mounted!.root, mounted!.host)
    mounted = null
    useDoc.setState(initial)
    useTranslation.getState().release('A')
    vi.unstubAllGlobals()
    installHost(null)
  })
  return {
    /** The element the view renders into. */
    get host(): HTMLDivElement { return mounted!.host },
    /** Shows `source` as session `A`'s loaded document, in reading mode. */
    async open(source: string): Promise<void> {
      useDoc.setState({ ...initial, sessionId: 'A', status: 'ready', mode: 'reading', source, savedSource: source,
        load: vi.fn().mockResolvedValue(undefined), meta: null })
      await act(async () => mounted!.root.render(<SessionView sessionId="A" />))
    },
  }
}
