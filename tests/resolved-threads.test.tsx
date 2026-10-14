// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ResolvedThreads } from '../ui/review/ResolvedThreads'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { resolveThreadEdits } from '../document/review-archive'
import { applyTextEdits } from '../document/edits'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('shows an empty resolved view while live comments remain separate', () => {
  act(() => root.render(<ResolvedThreads source="{>>live note<<}" onClose={() => {}} />))
  expect(host.textContent).toContain('No resolved discussions')
  expect(host.textContent).not.toContain('live note')
})
it('renders archived Unicode/spaced authors and literal original text safely', () => {
  const source = '{==context==}{>>@Da Wei: <img src=x onerror=alert(1)> question<<}{>>@李 明: answer<<}'
  const thread = analyzeMarkdown(source).items.find((item) => item.type === 'thread')!
  if (thread.type !== 'thread') throw new Error('Expected thread')
  const archived = applyTextEdits(source, resolveThreadEdits(source, thread))
  act(() => root.render(<ResolvedThreads source={archived} onClose={() => {}} />))
  expect(host.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Resolved discussions (1)')
  expect(host.textContent).toContain('@Da Wei')
  expect(host.textContent).toContain('@李 明')
  expect(host.textContent).toContain('<img src=x onerror=alert(1)> question')
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('.resolved-context')!.textContent).toBe('context')
  expect(host.querySelector('pre')!.textContent).toBe(source)
})
it.each(['<!-- mastermind:resolved-thread v99\nunknown\n-->', '<!-- mastermind:resolved-thread v1\nnot json\n-->'])(
  'displays diagnostic and preserves unknown/malformed record %j', (source) => {
    act(() => root.render(<ResolvedThreads source={source} onClose={() => {}} />))
    expect(host.textContent).toContain('Unrecognized archive entry')
    expect(host.querySelector('pre')!.textContent).toBe(source)
    expect(host.textContent).not.toContain('No resolved discussions')
  },
)
