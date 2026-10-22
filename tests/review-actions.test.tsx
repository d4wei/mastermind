// @vitest-environment jsdom
/// <reference types="vite/client" />
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { TextEdit } from '../document/types'
import { createDocStore } from '../ui/documents/store'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { parseResolvedThreads } from '../document/review-archive'
import * as reviewScroll from '../ui/util/scroll'
import { CommentRail } from '../ui/review/CommentRail'

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createDocStore>
let activate: ReturnType<typeof vi.fn<(spanIndex: number | null) => void>>
let edit: ReturnType<typeof vi.fn<(edits: TextEdit[]) => void>>

function Harness({ request }: { request?: { spanIndex: number } }) {
  const [active, setActive] = useState<number | null>(null)
  const source = store((state) => state.source)
  const analysis = analyzeMarkdown(source)
  const docRef = useRef<HTMLElement>(null)
  return <><article ref={docRef} /><CommentRail source={source} items={analysis.items} spans={analysis.spans}
    replyRequest={request} readOnly={store((state) => state.conflict)} docRef={docRef} authorTag="reviewer" activeSpan={active} onActivate={(index) => { activate(index); setActive(index) }} onEdit={edit} /></>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  store = createDocStore()
  activate = vi.fn()
  edit = vi.fn((edits) => store.getState().applyEdits(edits))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function render(source: string) {
  store.setState({ source, savedSource: source, status: 'ready' })
  act(() => root.render(<Harness />))
}
function click(label: string, index = 0) {
  if (label === 'Delete comment') {
    const trigger = host.querySelectorAll<HTMLButtonElement>('[aria-label="More"]')[index]!
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    act(() => document.querySelector<HTMLElement>('[role="menuitem"]')!.click())
    return
  }
  const buttons = Array.from(host.querySelectorAll('button')).filter((button) => button.textContent === label || button.getAttribute('aria-label') === label)
  act(() => buttons[index]!.click())
}

it('deletes one comment and retains its sibling, anchor and suggested edit in one undo', () => {
  const source = '{--suggestion--} {==context==}{>>@Da Wei: first<<}{>>@claude: second<<}'
  render(source)
  click('Delete comment')
  expect(store.getState().source).toBe('{--suggestion--} {==context==}{>>@claude: second<<}')
  expect(edit).toHaveBeenCalledTimes(1)
  expect(activate).toHaveBeenCalledTimes(1)
  act(() => store.getState().undo())
  expect(store.getState().source).toBe(source)
})

it('deleting the last comment preserves the highlighted prose and never archives', () => {
  render('{==context==}{>>@Da Wei: only<<} {++suggestion++}')
  click('Delete comment')
  expect(store.getState().source).toBe('context {++suggestion++}')
  expect(parseResolvedThreads(store.getState().source).entries).toHaveLength(0)
})

it('resolves the complete thread into the archive and undo restores exact bytes', () => {
  const source = '{~~old~>new~~} {==context==}{>>@Da Wei: first<<}{>>@claude: second<<}\r\n'
  render(source)
  click('Resolve')
  const resolved = store.getState().source
  expect(resolved.startsWith('{~~old~>new~~} context\r\n')).toBe(true)
  expect(analyzeMarkdown(resolved).items.filter((item) => item.type === 'thread')).toHaveLength(0)
  expect(parseResolvedThreads(resolved).entries[0]!.authors).toEqual(['Da Wei', 'claude'])
  expect(edit).toHaveBeenCalledTimes(1)
  act(() => store.getState().undo())
  expect(store.getState().source).toBe(source)
})

it('opens a focused reply from the keyboard control without making descendants presentational', () => {
  render('{>>@Alex: note<<}{>>@Sam: reply<<}')
  const button = host.querySelector<HTMLButtonElement>('.rail-select')!
  const card = host.querySelector<HTMLElement>('.rail-card')!
  expect(card.getAttribute('role')).toBe('group')
  expect(card.hasAttribute('tabindex')).toBe(false)
  expect(host.querySelector('[role="button"] button')).toBeNull()
  act(() => button.focus())
  expect(activate).not.toHaveBeenCalled()
  expect(button.getAttribute('aria-expanded')).toBe('false')
  act(() => button.click())
  expect(activate).toHaveBeenCalledWith(0)
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(host.querySelectorAll('.rail-comment')).toHaveLength(2)
  expect(document.activeElement).toBe(host.querySelector('textarea'))
})

it('refuses resolution when an unterminated tail would hide the archive', () => {
  const source = '{>>note<<}\n\n```\nunfinished code'
  render(source)
  click('Resolve')
  expect(store.getState().source).toBe(source)
  expect(edit).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('unterminated')
})

it('keeps opening comments readable and hides replies until their count is selected', () => {
  render('{==first==}{>>@Alex: one<<}{>>@Sam: answer<<} {==second==}{>>@Sam: two<<}')
  expect(Array.from(host.querySelectorAll('.rail-body'), (body) => body.textContent)).toEqual(['one', 'two'])
  click('1 reply')
  expect(Array.from(host.querySelectorAll('.rail-body'), (body) => body.textContent)).toEqual(['one', 'answer', 'two'])
  click('Collapse discussion')
  expect(host.querySelectorAll('.rail-comment-reply')).toHaveLength(0)
  expect(edit).not.toHaveBeenCalled()
})

it('reply textarea focus preserves activation and keyboard submission still edits the file', () => {
  const source = '{==context==}{>>@Da Wei: question<<}'
  render(source)
  click('Reply')
  const textarea = host.querySelector<HTMLTextAreaElement>('.rail-reply textarea')!
  expect(textarea.closest('[role="button"]')).toBeNull()
  expect(document.activeElement).toBe(textarea)
  expect(activate).toHaveBeenLastCalledWith(0)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(textarea, 'Answer 中文')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(textarea.value).toBe('Answer 中文')
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', ctrlKey: true, bubbles: true,
  })))
  expect(store.getState().source).toBe(source + '{>>@reviewer: Answer 中文<<}')
  expect(edit).toHaveBeenCalledTimes(1)
})

it('keeps the reply draft and ignores submit while the IME handles keys', () => {
  render('{>>@Da Wei: question<<}')
  click('Reply')
  const textarea = host.querySelector('textarea')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Existing reply')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true }))
  })
  expect(host.querySelector('textarea')).toBe(textarea)
  expect(textarea.value).toBe('Existing reply')
  expect(edit).not.toHaveBeenCalled()
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  expect(store.getState().source).toContain('{>>@reviewer: Existing reply<<}')
})

it('retains separate reply drafts when collapsing and switching discussions', () => {
  render('{==first==}{>>@Alex: one<<} {==second==}{>>@Sam: two<<}')
  click('Reply', 0)
  const type = (value: string) => act(() => {
    const input = host.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  type('First unfinished reply')
  click('Reply', 1)
  expect(host.querySelector('textarea')!.value).toBe('')
  type('Second unfinished reply')
  act(() => host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('textarea')).toBeNull()
  click('Reply', 0)
  expect(host.querySelector('textarea')!.value).toBe('First unfinished reply')
  click('Reply', 1)
  expect(host.querySelector('textarea')!.value).toBe('Second unfinished reply')
  expect(edit).not.toHaveBeenCalled()
})

it('keeps hover separate from selection and never changes card positions on hover', () => {
  render('{==first==}{>>@Alex: one<<}{>>@Sam: answer<<}')
  const card = host.querySelector<HTMLElement>('.rail-card')!
  const top = card.style.top
  act(() => card.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
  expect(activate).not.toHaveBeenCalled()
  expect(card.style.top).toBe(top)
  expect(card.querySelectorAll('.rail-body')).toHaveLength(1)
})

it('preserves the expanded thread and reading position after appending a reply', () => {
  const reveal = vi.spyOn(reviewScroll, 'revealElement')
  render('{==context==}{>>@Alex: question<<}')
  click('Reply')
  const input = host.querySelector('textarea')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Answer')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const card = host.querySelector('.rail-card')!
  act(() => vi.advanceTimersByTime(40))
  reveal.mockClear()
  click('Reply')
  expect(host.querySelector('.rail-card')).toBe(card)
  expect(host.querySelectorAll('.rail-body')).toHaveLength(2)
  expect(host.querySelector('textarea')).toBeNull()
  expect(host.querySelector('.rail-select')!.getAttribute('aria-expanded')).toBe('true')
  act(() => vi.advanceTimersByTime(40))
  expect(reveal).not.toHaveBeenCalled()
  reveal.mockRestore()
})

it('retains the draft but disables mutation if a conflict arrives while replying', () => {
  render('{>>@Alex: question<<}')
  click('Reply')
  const textarea = host.querySelector('textarea')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Keep this draft')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => store.setState({ conflict: true }))
  expect(textarea.readOnly).toBe(true)
  expect(textarea.value).toBe('Keep this draft')
  click('Reply')
  click('Resolve')
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  click('Delete comment')
  expect(edit).not.toHaveBeenCalled()
  expect(store.getState().source).toBe('{>>@Alex: question<<}')
})


it('keeps the quoted passage visible before, during and after replying', () => {
  render('{==context==}{>>@Alex: question<<}')
  const quote = () => host.querySelector('.rail-card-anchor')?.textContent
  expect(quote()).toBe('context')
  click('Reply')
  expect(quote()).toBe('context')
  click('Collapse discussion')
  expect(quote()).toBe('context')
})

it('opens a reply on the card body and focuses it again on repeat clicks', () => {
  render('{==context==}{>>@Alex: question<<}')
  const body = host.querySelector<HTMLElement>('.rail-body')!
  act(() => body.click())
  const input = host.querySelector('textarea')!
  expect(document.activeElement).toBe(input)
  act(() => input.blur())
  act(() => body.click())
  expect(document.activeElement).toBe(input)
  expect(edit).not.toHaveBeenCalled()
})

it('does not open a reply when selecting comment text', () => {
  render('{>>@Alex: selectable words<<}')
  const body = host.querySelector<HTMLElement>('.rail-body')!
  const range = document.createRange()
  range.selectNodeContents(body)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  act(() => body.click())
  expect(activate).not.toHaveBeenCalled()
  expect(host.querySelector('textarea')).toBeNull()
  window.getSelection()!.removeAllRanges()
})

it('opens a reply for each passage request, including after cancelling the same thread', () => {
  render('{==context==}{>>@Alex: question<<}')
  click('Reply')
  click('Cancel')
  expect(host.querySelector('textarea')).toBeNull()
  act(() => root.render(<Harness request={{ spanIndex: 0 }} />))
  expect(document.activeElement).toBe(host.querySelector('textarea'))
  click('Cancel')
  act(() => root.render(<Harness request={{ spanIndex: 0 }} />))
  expect(document.activeElement).toBe(host.querySelector('textarea'))
})

it('returns keyboard focus to the card when Escape closes the composer', () => {
  render('{>>@Alex: question<<}')
  click('Reply')
  act(() => host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.activeElement).toBe(host.querySelector('.rail-select'))
})

it('keeps paused discussions readable without opening a new reply input', () => {
  render('{==context==}{>>@Alex: question<<}')
  act(() => store.setState({ conflict: true }))
  act(() => host.querySelector<HTMLElement>('.rail-body')!.click())
  expect(host.querySelector('textarea')).toBeNull()
  expect(host.querySelector('.rail-card-anchor')!.textContent).toBe('context')
})
