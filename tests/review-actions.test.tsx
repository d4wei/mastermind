// @vitest-environment jsdom
/// <reference types="vite/client" />
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { TextEdit } from '../src/shared/types'
import { createDocStore } from '../src/ui/app/store'
import { analyzeMarkdown } from '../src/shared/markdown/analyze'
import { parseResolvedThreads } from '../src/shared/review-archive'
import { CommentRail } from '../src/ui/review/CommentRail'

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

it('keyboard activation on the card does not intercept a focused Delete button', () => {
  render('{>>@Da Wei: note<<}')
  const button = host.querySelector<HTMLButtonElement>('.rail-delete')!
  button.focus()
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
