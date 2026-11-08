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

function archive(source: string): string {
  const thread = analyzeMarkdown(source).items.find((item) => item.type === 'thread')!
  if (thread.type !== 'thread') throw new Error('Expected thread')
  return applyTextEdits(source, resolveThreadEdits(source, thread))
}
const button = (label: string) => Array.from(host.querySelectorAll('button'))
  .find((item) => item.textContent === label || item.getAttribute('aria-label') === label)!

it('shows a designed empty state while live comments remain separate', () => {
  act(() => root.render(<ResolvedThreads source="{>>live note<<}" onClose={() => {}} />))
  const empty = host.querySelector('.resolved-empty')!
  expect(empty.querySelector('svg')).not.toBeNull()
  expect(empty.textContent).toBe('No resolved discussionsResolved discussions stay here for reference.')
  expect(host.textContent).not.toContain('live note')
})

it('renders archived Unicode/spaced authors and literal original text safely', () => {
  const source = '{==context==}{>>@Da Wei: <img src=x onerror=alert(1)> question<<}{>>@李 明: answer<<}'
  act(() => root.render(<ResolvedThreads source={archive(source)} onClose={() => {}} />))
  expect(host.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Resolved discussions (1)')
  expect(host.textContent).toContain('<img src=x onerror=alert(1)> question')
  act(() => button('1 reply').click())
  expect(Array.from(host.querySelectorAll('.rail-author'), (author) => author.textContent)).toEqual(['Da Wei', '李 明'])
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('pre')).toBeNull()
  act(() => button('Markdown source').click())
  expect(host.querySelector('pre')!.textContent).toBe(source)
})

it('quotes the passage and discloses replies and Markdown source with the app chevron', () => {
  const source = '{==the quoted passage==}{>>@Alex: opening<<}{>>@Sam: first<<}{>>@Alex: second<<}'
  act(() => root.render(<ResolvedThreads source={archive(source)} onClose={() => {}} />))
  const quote = host.querySelector('blockquote.resolved-quote')!
  expect(quote.textContent).toBe('the quoted passage')
  expect(quote.getAttribute('aria-label')).toBe('Quoted passage')
  expect(host.querySelector('details, summary')).toBeNull()
  expect(Array.from(host.querySelectorAll('.rail-body'), (body) => body.textContent)).toEqual(['opening'])
  const toggle = button('2 replies')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(toggle.querySelector('svg')).not.toBeNull()
  act(() => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).not.toBeNull()
  expect(Array.from(host.querySelectorAll('.rail-body'), (body) => body.textContent)).toEqual(['opening', 'first', 'second'])
  act(() => toggle.click())
  expect(host.querySelectorAll('.resolved-reply')).toHaveLength(0)
})

it.each(['<!-- mastermind:resolved-thread v99\nunknown\n-->', '<!-- mastermind:resolved-thread v1\nnot json\n-->'])(
  'displays diagnostic and preserves unknown/malformed record %j', (source) => {
    act(() => root.render(<ResolvedThreads source={source} onClose={() => {}} />))
    expect(host.textContent).toContain('Unrecognized archive entry')
    expect(host.querySelector('pre')!.textContent).toBe(source)
    expect(host.textContent).not.toContain('No resolved discussions')
  },
)
