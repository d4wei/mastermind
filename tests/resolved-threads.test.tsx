// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ResolvedThreads } from '../ui/review/ResolvedThreads'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { resolveThreadEdits } from '../document/review-archive'
import type { TextEdit } from '../document/types'
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
})

it('lays each card out like a live comment: author, quoted passage, then comment, with no source view', () => {
  const source = '{==the quoted passage==}{>>@Alex: opening<<}{>>@Sam: first<<}{>>@Alex: second<<}'
  act(() => root.render(<ResolvedThreads source={archive(source)} onClose={() => {}} />))
  const opening = host.querySelector('.resolved-card > .rail-comment')!
  expect(Array.from(opening.children, (child) => child.className)).toEqual(['rail-message-header', 'rail-card-anchor', 'rail-body'])
  const quote = opening.querySelector('blockquote.rail-card-anchor')!
  expect(quote.textContent).toBe('the quoted passage')
  expect(quote.getAttribute('aria-label')).toBe('Quoted passage')
  expect(opening.querySelector('.rail-message-header')!.textContent).toBe('Alex')
  expect(Array.from(host.querySelectorAll('.resolved-card button'), (item) => item.getAttribute('aria-label') ?? item.textContent))
    .toEqual(['More', '2 replies'])
  expect(host.textContent).not.toContain('Markdown source')
})

it('discloses replies with the chevron toggle the live comment rail shares', () => {
  const source = '{==the quoted passage==}{>>@Alex: opening<<}{>>@Sam: first<<}{>>@Alex: second<<}'
  act(() => root.render(<ResolvedThreads source={archive(source)} onClose={() => {}} />))
  expect(host.querySelector('details, summary')).toBeNull()
  expect(Array.from(host.querySelectorAll('.rail-body'), (body) => body.textContent)).toEqual(['opening'])
  const toggle = button('2 replies')
  expect(toggle.classList.contains('rail-replies-toggle')).toBe(true)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(toggle.querySelector('svg')).not.toBeNull()
  act(() => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).not.toBeNull()
  expect(Array.from(host.querySelectorAll('.rail-body'), (body) => body.textContent)).toEqual(['opening', 'first', 'second'])
  act(() => toggle.click())
  expect(host.querySelectorAll('.rail-comment-reply')).toHaveLength(0)
})

it.each(['<!-- mastermind:resolved-thread v99\nunknown\n-->', '<!-- mastermind:resolved-thread v1\nnot json\n-->'])(
  'displays diagnostic and preserves unknown/malformed record %j', (source) => {
    act(() => root.render(<ResolvedThreads source={source} onClose={() => {}} />))
    expect(host.textContent).toContain('Unrecognized archive entry')
    expect(host.querySelector('pre')!.textContent).toBe(source)
    expect(host.textContent).not.toContain('No resolved discussions')
  },
)

function openMenu(index = 0) {
  const trigger = host.querySelectorAll<HTMLButtonElement>('.resolved-card [aria-label="More"]')[index]!
  act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  return document.querySelector<HTMLElement>('[role="menuitem"]')!
}

it('offers Delete discussion from the opening message menu, like a live card', () => {
  const source = archive('{==passage==}{>>@Alex: opening<<}{>>@Sam: reply<<}')
  act(() => root.render(<ResolvedThreads source={source} onClose={() => {}} onEdit={() => true} />))
  const trigger = host.querySelector<HTMLButtonElement>('.resolved-card [aria-label="More"]')!
  expect(trigger.className).toBe('btn-ghost btn-icon rail-icon')
  expect(trigger.closest('.rail-message-header')?.parentElement?.classList.contains('rail-comment-reply')).toBe(false)
  const item = openMenu()
  expect(item.className).toBe('reader-menu-item')
  expect(item.closest('.reader-menu')).not.toBeNull()
  expect(item.textContent).toBe('Delete discussion')
  expect(item.firstElementChild?.tagName.toLowerCase()).toBe('svg')
  expect(item.getAttribute('aria-disabled')).toBeNull()
})

it('deletes only the chosen discussion through one exact splice', () => {
  const first = archive('One {>>@A: first<<}.\n\nTwo {>>@B: second<<}.\n')
  const source = archive(first)
  const onEdit = vi.fn((_edits: TextEdit[]) => true)
  act(() => root.render(<ResolvedThreads source={source} onClose={() => {}} onEdit={onEdit} />))
  expect(host.querySelectorAll('.resolved-card')).toHaveLength(2)
  const item = openMenu(1)
  act(() => item.click())
  expect(onEdit).toHaveBeenCalledTimes(1)
  const after = applyTextEdits(source, onEdit.mock.calls[0]![0])
  expect(after).toBe(first.replace('{>>@B: second<<}', ''))
})

it.each([
  ['paused editing', { readOnly: true, onEdit: () => true }],
  ['no edit path', {}],
])('disables Delete discussion with %s', (_label, props) => {
  const onEdit = vi.fn(() => true)
  const source = archive('{==passage==}{>>@Alex: note<<}')
  act(() => root.render(<ResolvedThreads source={source} onClose={() => {}} {...props} />))
  const item = openMenu()
  expect(item.getAttribute('aria-disabled')).toBe('true')
  act(() => item.click())
  expect(onEdit).not.toHaveBeenCalled()
  expect(host.querySelectorAll('.resolved-card')).toHaveLength(1)
})

it('closes the card menu on Escape and leaves the panel open', () => {
  const onClose = vi.fn()
  act(() => root.render(<ResolvedThreads source={archive('{>>@Alex: note<<}')} onClose={onClose} onEdit={() => true} />))
  const item = openMenu()
  act(() => item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[role="menuitem"]')).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(onClose).toHaveBeenCalledTimes(1)
})
