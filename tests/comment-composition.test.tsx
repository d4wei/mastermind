// @vitest-environment jsdom
import { act, useRef } from 'react'
import type { Root } from 'react-dom/client'
import { createReactHost, removeReactHost, inputValue } from './helpers/dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { READING_LAYOUT_EVENT } from '../ui/app/reading-space'
import { SelectionToolbar } from '../ui/modes/reading/SelectionToolbar'

let host: HTMLDivElement
let root: Root
const edit = vi.fn()
let selectionRect: DOMRect
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
function Harness({ readOnly = false }: { readOnly?: boolean }) {
  const containerRef = useRef<HTMLElement>(null)
  return <><div className="document-scroll"><article ref={containerRef}><p><span data-ps="0" data-pe="7">Passage</span></p></article></div>
    <SelectionToolbar readOnly={readOnly} containerRef={containerRef} source="Passage" spans={[]} authorTag="reviewer" onEdit={edit} /></>
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  edit.mockReset()
  selectionRect = { top: 100, left: 100, width: 40 } as DOMRect
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => selectionRect })
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  window.getSelection()?.removeAllRanges()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  if (rangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeBounds)
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
})
async function compose(action = 'Comment') {
  act(() => root.render(<Harness />))
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('span')!)
  window.getSelection()!.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
  await act(async () => vi.advanceTimersByTimeAsync(120))
  act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('.sel-toolbar button')).find((b) => b.textContent === action)!.click())
  const textarea = host.querySelector('textarea')!
  act(() => {
    inputValue(textarea, 'Existing draft')
  })
  return textarea
}

it('keeps a selection composer draft while IME Escape cancels marked text', async () => {
  const textarea = await compose()
  act(() => {
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
  })
  expect(host.querySelector('textarea')).toBe(textarea)
  expect(textarea.value).toBe('Existing draft')
  expect(edit).not.toHaveBeenCalled()
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('textarea')).toBeNull()
})

it('does not submit a selection composer during IME or its final legacy key', async () => {
  const textarea = await compose()
  act(() => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true,
      isComposing: true, bubbles: true }))
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true,
      keyCode: 229, bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true }))
  })
  expect(host.querySelector('textarea')).toBe(textarea)
  expect(textarea.value).toBe('Existing draft')
  expect(edit).not.toHaveBeenCalled()
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  expect(edit).toHaveBeenCalledOnce()
})

it('resets IME state when a selection composer is removed without blur', async () => {
  const textarea = await compose()
  act(() => textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  const cancel = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!
  act(() => cancel.click())
  expect(host.querySelector('textarea')).toBeNull()
  act(() => host.querySelector<HTMLButtonElement>('.sel-toolbar button')!.click())
  const reopened = host.querySelector('textarea')!
  act(() => reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('textarea')).toBeNull()
  expect(edit).not.toHaveBeenCalled()
})

it.each(['scroll', 'layout'])('keeps the composer anchored during %s changes', async (change) => {
  await compose()
  const toolbar = host.querySelector<HTMLElement>('.sel-toolbar')!
  const initialTop = toolbar.style.top
  selectionRect = { top: 300, left: 200, width: 40 } as DOMRect
  if (change === 'layout') window.getSelection()!.removeAllRanges()
  act(() => change === 'scroll'
    ? host.querySelector('.document-scroll')!.dispatchEvent(new Event('scroll'))
    : window.dispatchEvent(new Event(READING_LAYOUT_EVENT)))
  await act(async () => vi.advanceTimersByTimeAsync(32))
  expect(toolbar.style.top).not.toBe(initialTop)
  expect(host.querySelector('textarea')!.value).toBe('Existing draft')
})

it('retains an unsubmitted comment when editing pauses and prevents submit', async () => {
  const textarea = await compose()
  act(() => root.render(<Harness readOnly />))
  expect(host.querySelector('textarea')).toBe(textarea)
  expect(textarea.value).toBe('Existing draft')
  expect(textarea.readOnly).toBe(true)
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  expect(edit).not.toHaveBeenCalled()
  expect(textarea.value).toBe('Existing draft')
  act(() => root.render(<Harness />))
  expect(textarea.readOnly).toBe(false)
})

it('prefills a replacement and submits a substitution, or a deletion when cleared', async () => {
  await compose('Suggest change')
  const textarea = host.querySelector('textarea')!
  act(() => inputValue(textarea, '新段落'))
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  expect(edit).toHaveBeenLastCalledWith([{ from: 0, to: 7, insert: '{~~Passage~>新段落~~}' }])
  await compose('Suggest change')
  act(() => inputValue(host.querySelector('textarea')!, ''))
  act(() => host.querySelector<HTMLButtonElement>('.btn-primary')!.click())
  expect(edit).toHaveBeenLastCalledWith([{ from: 0, to: 7, insert: '{--Passage--}' }])
})

it('keeps change drafts during IME and blocks unchanged, invalid, or paused submissions', async () => {
  const textarea = await compose('Suggest change')
  act(() => inputValue(textarea, 'Passage'))
  expect(host.querySelector<HTMLButtonElement>('.btn-primary')!.disabled).toBe(true)
  act(() => inputValue(textarea, 'broken~~}'))
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  expect(host.querySelector<HTMLButtonElement>('.btn-primary')!.disabled).toBe(true)
  act(() => inputValue(textarea, '候选'))
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true })))
  expect(edit).not.toHaveBeenCalled()
  act(() => root.render(<Harness readOnly />))
  expect(textarea.value).toBe('候选')
  expect(textarea.readOnly).toBe(true)
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  expect(edit).not.toHaveBeenCalled()
})
