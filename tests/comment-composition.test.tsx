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
function Harness({ readOnly = false, text = 'Passage', source = text }: { readOnly?: boolean; text?: string; source?: string }) {
  const containerRef = useRef<HTMLElement>(null)
  return <><div className="document-scroll"><article ref={containerRef}><p><span data-ps="0" data-pe={text.length}>{text}</span></p></article></div>
    <SelectionToolbar readOnly={readOnly} containerRef={containerRef} source={source} spans={[]} authorTag="reviewer" onEdit={edit} /></>
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
async function select(harness = <Harness />) {
  act(() => root.render(harness))
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('span')!)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
  await act(async () => vi.advanceTimersByTimeAsync(120))
}
async function compose(action = 'Comment', harness = <Harness />) {
  await select(harness)
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


it.each(['Comment', 'Suggest change'])('keeps %s open when an earlier selection check fires after entry', async (action) => {
  await compose()
  act(() => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!.click())
  act(() => document.dispatchEvent(new Event('selectionchange')))
  act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('.sel-toolbar button')).find((button) => button.textContent === action)!.click())
  const textarea = host.querySelector('textarea')!
  act(() => {
    window.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    inputValue(textarea, 'Draft survives pending selection work')
  })
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(host.querySelector('textarea')).toBe(textarea)
  expect(textarea.value).toBe('Draft survives pending selection work')
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await compose(action)
  expect(host.querySelector('textarea')).not.toBeNull()
  expect(edit).not.toHaveBeenCalled()
})

it('does not enter a hidden composer from an exiting toolbar', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  await compose()
  act(() => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!.click())
  act(() => {
    window.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
  })
  await act(async () => vi.advanceTimersByTimeAsync(120))
  const button = host.querySelector<HTMLButtonElement>('.sel-toolbar button')!
  act(() => button.click())
  await act(async () => vi.advanceTimersByTimeAsync(120))
  expect(host.querySelector('textarea')).toBeNull()
  await compose()
  expect(host.querySelector('textarea')).not.toBeNull()
})

it('captures the latest selection when an action beats the selection debounce', async () => {
  await compose()
  act(() => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!.click())
  const range = document.createRange()
  const text = host.querySelector('span')!.firstChild!
  range.setStart(text, 0); range.setEnd(text, 4)
  act(() => {
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('.sel-toolbar button')).find((button) => button.textContent === 'Suggest change')!.click())
  expect(host.querySelector('textarea')!.value).toBe('Pass')
})

it('Escape cancels a pending selection check without reviving the toolbar', async () => {
  await compose()
  act(() => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!.click())
  act(() => document.dispatchEvent(new Event('selectionchange')))
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(host.querySelector('.sel-toolbar')).toBeNull()
  await compose()
  expect(host.querySelector('textarea')).not.toBeNull()
})

it('re-reads a surviving selection when the source changes under a shown toolbar', async () => {
  await select()
  act(() => root.render(<Harness source={'Passage\n'} />))
  await act(async () => vi.advanceTimersByTimeAsync(120))
  act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('.sel-toolbar button')).find((b) => b.textContent === 'Comment')!.click())
  const textarea = host.querySelector('textarea')!
  act(() => inputValue(textarea, 'Note'))
  expect(host.querySelector('[role="status"]')).toBeNull()
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  expect(edit).toHaveBeenCalledWith([{ from: 0, to: 7, insert: '{==Passage==}{>>@reviewer: Note<<}' }])
})

it('blocks a comment whose selected text would not reparse as its anchor', async () => {
  const textarea = await compose('Comment', <Harness text="a ==}" />)
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('This passage cannot anchor a comment. Select text without review delimiters.')
  expect(host.querySelector<HTMLButtonElement>('.btn-primary')!.disabled).toBe(true)
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  expect(edit).not.toHaveBeenCalled()
})

it('leaves Escape to an open settings panel', async () => {
  await select()
  const panel = document.createElement('div')
  panel.className = 'slide-over'; panel.setAttribute('role', 'dialog')
  document.body.append(panel)
  try {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(host.querySelector('.sel-toolbar')).not.toBeNull()
  } finally { panel.remove() }
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(host.querySelector('.sel-toolbar')).toBeNull()
})
