// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SelectionToolbar } from '../ui/modes/reading/SelectionToolbar'
import { BlockActions } from '../ui/modes/reading/BlockActions'

let host: HTMLDivElement
let root: Root
const edit = vi.fn()
function Harness({ block }: { block: boolean }) {
  const containerRef = useRef<HTMLElement>(null)
  const Component = block ? BlockActions : SelectionToolbar
  return <><article ref={containerRef}><p><span data-ps="0" data-pe="7">Passage</span></p></article>
    <Component containerRef={containerRef} source="Passage" spans={[]} authorTag="reviewer" onEdit={edit} /></>
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  edit.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  window.getSelection()?.removeAllRanges()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function compose(block: boolean) {
  act(() => root.render(<Harness block={block} />))
  if (block) {
    act(() => host.querySelector('p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    act(() => host.querySelector<HTMLButtonElement>('.block-trigger')!.click())
    act(() => host.querySelector<HTMLButtonElement>('.block-menu button')!.click())
  } else {
    const range = document.createRange()
    range.selectNodeContents(host.querySelector('span')!)
    range.getBoundingClientRect = () => ({ top: 100, left: 100, width: 40 } as DOMRect)
    window.getSelection()!.addRange(range)
    act(() => document.dispatchEvent(new Event('selectionchange')))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    act(() => host.querySelector<HTMLButtonElement>('.sel-toolbar button')!.click())
  }
  const textarea = host.querySelector('textarea')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Existing draft')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return textarea
}

it.each([false, true])('keeps a %s block composer draft while IME Escape cancels marked text', async (block) => {
  const textarea = await compose(block)
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

it.each([false, true])('does not submit %s block composer during IME or its final legacy key', async (block) => {
  const textarea = await compose(block)
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

it.each([false, true])('resets IME state when a %s block composer is removed without blur', async (block) => {
  const textarea = await compose(block)
  act(() => textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  const cancel = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!
  act(() => cancel.click())
  expect(host.querySelector('textarea')).toBeNull()
  if (block) {
    act(() => host.querySelector('p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    act(() => host.querySelector<HTMLButtonElement>('.block-trigger')!.click())
    act(() => host.querySelector<HTMLButtonElement>('.block-menu button')!.click())
  } else {
    act(() => host.querySelector<HTMLButtonElement>('.sel-toolbar button')!.click())
  }
  const reopened = host.querySelector('textarea')!
  act(() => reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('textarea')).toBeNull()
  expect(edit).not.toHaveBeenCalled()
})
