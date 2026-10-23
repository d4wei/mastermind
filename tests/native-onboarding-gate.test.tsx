// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import { App } from '../ui/app/App'

const mocks = vi.hoisted(() => ({ load: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../ui/app/configStore', () => ({ useConfig: (selector: (state: unknown) => unknown) =>
  selector({ load: mocks.load }) }))
vi.mock('../ui/app/route', () => ({ useRoute: () => ({ kind: 'doc', sessionId: '4' }) }))
vi.mock('../ui/app/SessionView', () => ({ SessionView: () => <article>Retained document</article> }))
vi.mock('../ui/theme/ThemeProvider', () => ({ ThemeEffects: () => null }))

beforeEach(() => { mocks.load.mockReset().mockResolvedValue(undefined) })

it('keeps the native reviewer unmounted during setup and exposes its retained route afterward', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.load.mockRejectedValueOnce(new Error('Preferences unreadable'))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<App onboarding={<main>Setup recovery</main>} />))
    expect(host.textContent).toBe('Setup recovery')
    expect(host.querySelector('article')).toBeNull()
    expect(mocks.load).not.toHaveBeenCalled()
    await act(async () => root.render(<App />))
    expect(host.querySelector('article')!.textContent).toBe('Retained document')
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})

it('does not start a stale native config read while setup owns the confirmed reload', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let savedName = 'Before confirmation'
  let loadedName = ''
  const pending: (() => void)[] = []
  mocks.load.mockImplementation(() => {
    const captured = savedName
    return new Promise<void>((resolve) => pending.push(() => { loadedName = captured; resolve() }))
  })
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<App onboarding={<main>Pending setup</main>} />))
    expect(pending).toHaveLength(0)
    savedName = 'Confirmed reader'
    const confirmationReload = mocks.load()
    pending.shift()!()
    await confirmationReload
    expect(loadedName).toBe('Confirmed reader')
    await act(async () => root.render(<App />))
    expect(pending).toHaveLength(1)
    await act(async () => pending.shift()!())
    expect(loadedName).toBe('Confirmed reader')
  } finally {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  }
})
