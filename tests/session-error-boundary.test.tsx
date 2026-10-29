// @vitest-environment jsdom
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../ui/app/App'
import { installHost } from '../ui/app/host'
import { useDoc } from '../ui/documents/store'
import { createReactHost, removeReactHost } from './helpers/dom'
import { fakeHost } from './helpers/host'

vi.mock('../ui/app/route', () => ({ useRoute: () => ({ kind: 'doc', sessionId: 'broken.md' }), navigate: vi.fn() }))
vi.mock('../ui/app/SessionView', () => ({ SessionView: () => { throw new Error('render failure') } }))

let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  installHost(fakeHost({
    async getSession(id) { return { sessionId: id, displayName: id, path: id } },
    async getFile() { return { content: '# Title\n\nBody {++text++}\n', version: 'v1' } },
  }))
  await useDoc.getState().load('broken.md')
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  installHost(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('replaces a failed document view with a notice and its read-only Markdown and logs the error', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  act(() => root.render(<><nav className="file-tabs">tabs</nav><App /></>))
  expect(host.querySelector('.file-tabs')?.textContent).toBe('tabs')
  expect(host.querySelector('.session-fallback [role="alert"]')?.textContent)
    .toBe('This document could not be displayed. Its Markdown is shown read-only.')
  expect(host.querySelector('.session-fallback-source')?.textContent).toBe('# Title\n\nBody {++text++}\n')
  expect(host.querySelector('textarea, [contenteditable="true"]')).toBeNull()
  expect(logged.mock.calls.some(([message]) => message === 'Document view failed to render')).toBe(true)
})
