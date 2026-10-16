// @vitest-environment jsdom
import { act, useRef } from 'react'
import type { Root } from 'react-dom/client'
import { createReactHost, removeReactHost, inputValue } from './helpers/dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SelectionToolbar } from '../ui/modes/reading/SelectionToolbar'

let host: HTMLDivElement
let root: Root
const edit = vi.fn()
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
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  window.getSelection()?.removeAllRanges()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function compose() {
  act(() => root.render(<Harness />))
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('span')!)
  range.getBoundingClientRect = () => ({ top: 100, left: 100, width: 40 } as DOMRect)
  window.getSelection()!.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
  await act(async () => vi.advanceTimersByTimeAsync(120))
  act(() => host.querySelector<HTMLButtonElement>('.sel-toolbar button')!.click())
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

it('repositions the selection controls when the document container scrolls', async () => {
  await compose()
  const toolbar = host.querySelector<HTMLElement>('.sel-toolbar')!
  const initialTop = toolbar.style.top
  window.getSelection()!.getRangeAt(0).getBoundingClientRect = () =>
    ({ top: 300, left: 100, width: 40 } as DOMRect)
  act(() => host.querySelector('.document-scroll')!.dispatchEvent(new Event('scroll')))
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
