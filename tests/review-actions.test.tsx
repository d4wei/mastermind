// @vitest-environment jsdom
/// <reference types="vite/client" />
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { TextEdit } from '../document/types'
import { createDocStore } from '../ui/documents/store'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { parseResolvedThreads } from '../document/review-archive'
import { CommentRail } from '../ui/review/CommentRail'

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createDocStore>
let activate: ReturnType<typeof vi.fn<(spanIndex: number | null) => void>>
let edit: ReturnType<typeof vi.fn<(edits: TextEdit[]) => void>>

function Harness() {
  const source = store((state) => state.source)
  const analysis = analyzeMarkdown(source)
  const docRef = useRef<HTMLElement>(null)
  return <><article ref={docRef} /><CommentRail source={source} items={analysis.items} spans={analysis.spans}
    docRef={docRef} authorTag="reviewer" activeSpan={null} onActivate={activate} onEdit={edit} /></>
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
  const buttons = Array.from(host.querySelectorAll('button')).filter((button) => button.textContent === label)
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

it('keyboard focus activates the anchor without making the card a button', () => {
  render('{>>@Da Wei: note<<}')
  const button = host.querySelector<HTMLButtonElement>('.rail-delete')!
  const card = host.querySelector<HTMLElement>('.rail-card')!
  expect(card.getAttribute('role')).toBe('group')
  expect(card.hasAttribute('tabindex')).toBe(false)
  expect(host.querySelector('[role="button"] button')).toBeNull()
  act(() => button.focus())
  expect(activate).toHaveBeenCalledWith(0)
  activate.mockClear()
  act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(activate).not.toHaveBeenCalled()
  click('Delete comment')
  expect(store.getState().source).toBe('')
})

it('refuses resolution when an unterminated tail would hide the archive', () => {
  const source = '{>>note<<}\n\n```\nunfinished code'
  render(source)
  click('Resolve')
  expect(store.getState().source).toBe(source)
  expect(edit).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('unterminated')
})

it('each thread control remains focusable and activates its own anchor', () => {
  const source = '{==first==}{>>@Da Wei: one<<} {==second==}{>>@reviewer: two<<}'
  render(source)
  const analysis = analyzeMarkdown(source)
  const threads = analysis.items.filter((item) => item.type === 'thread')
  const cards = host.querySelectorAll('.rail-card')
  cards.forEach((card, index) => {
    const anchor = threads[index]!.anchor!
    const spanIndex = analysis.spans.indexOf(anchor)
    const controls = card.querySelectorAll<HTMLButtonElement>('button')
    expect(Array.from(controls, (control) => control.textContent)).toEqual([
      'Delete comment', 'Reply', 'Resolve',
    ])
    controls.forEach((control) => {
      expect(control.closest('[role="button"]')).toBeNull()
      act(() => control.focus())
      expect(document.activeElement).toBe(control)
      expect(activate).toHaveBeenLastCalledWith(spanIndex)
    })
  })
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
