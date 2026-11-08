// @vitest-environment jsdom
import { act, useRef, useState, type RefObject } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { CommentRail } from '../ui/review/CommentRail'
import { SelectionToolbar } from '../ui/modes/reading/SelectionToolbar'
import type { ReplyDraft } from '../ui/review/thread-identity'
import { createReactHost, inputValue, removeReactHost } from './helpers/dom'

// Drafts are checked in their blocks and submissions in the whole document; here the two disagree,
// as they can when a definition outside the block decides how the mark renders.
const verify = vi.hoisted(() => ({ scopes: [] as (string | undefined)[] }))
vi.mock('../ui/modes/reading/marks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/modes/reading/marks')>()
  return {
    ...actual,
    commentVerdict: (...args: Parameters<typeof actual.commentVerdict>) => {
      verify.scopes.push(args[5])
      return args[5] === 'block' ? actual.commentVerdict(...args) : { refused: 'formatting' }
    },
    replyEdits: (...args: Parameters<typeof actual.replyEdits>) => {
      verify.scopes.push(args[5])
      return args[5] === 'block' ? actual.replyEdits(...args) : null
    },
  }
})

let host: HTMLDivElement
let root: Root
const edit = vi.fn()
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  verify.scopes = []
  edit.mockReset()
  edit.mockReturnValue(true)
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true,
    value: () => ({ top: 100, left: 100, width: 40, bottom: 120 }) })
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  window.getSelection()?.removeAllRanges()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  if (rangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeBounds)
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
})

const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!

it('lets a selection comment submit only after the whole-document check, and shows its refusal', async () => {
  vi.useFakeTimers()
  const text = 'Passage'
  function Harness() {
    const containerRef = useRef<HTMLElement>(null)
    return <><div className="document-scroll"><article ref={containerRef}><p><span data-ps="0" data-pe={text.length}>{text}</span></p></article></div>
      <SelectionToolbar containerRef={containerRef} source={text} analysis={analyzeMarkdown(text)} authorTag="me" onEdit={edit} /></>
  }
  act(() => root.render(<Harness />))
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('span')!)
  window.getSelection()!.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
  await act(async () => vi.advanceTimersByTimeAsync(120))
  act(() => button('Comment').click())
  act(() => inputValue(host.querySelector('textarea')!, 'Looks good'))
  const submit = [...host.querySelectorAll<HTMLButtonElement>('.sel-composer-actions button')].at(-1)!
  expect(submit.disabled).toBe(false)
  expect(verify.scopes).not.toContain(undefined)
  act(() => submit.click())
  expect(verify.scopes.at(-1)).toBe('document')
  expect(edit).not.toHaveBeenCalled()
  expect(submit.disabled).toBe(true)
  expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/surrounding Markdown/)
  act(() => inputValue(host.querySelector('textarea')!, 'Looks good!'))
  expect(submit.disabled).toBe(false)
})

it('lets a reply post only after the whole-document check, keeping the draft when it refuses', () => {
  const source = 'A {==passage==}{>>@a: note<<} here.\n'
  const analysis = analyzeMarkdown(source)
  function Harness() {
    const docRef = useRef<HTMLElement>(null)
    const [drafts, setDrafts] = useState<ReplyDraft[]>([])
    return <><article ref={docRef}><mark data-span-index={analysis.threads[0]!.spanIndex} /></article>
      <CommentRail source={source} analysis={analysis} docRef={docRef as RefObject<HTMLElement | null>} authorTag="me"
        activeSpan={analysis.threads[0]!.spanIndex} onActivate={() => {}} onEdit={edit} drafts={drafts}
        onDraftsChange={setDrafts} /></>
  }
  act(() => root.render(<Harness />))
  const reply = host.querySelector('textarea')!
  act(() => inputValue(reply, 'Agreed'))
  expect(button('Reply').disabled).toBe(false)
  expect(verify.scopes).toEqual(['block'])
  act(() => button('Reply').click())
  expect(verify.scopes.at(-1)).toBeUndefined()
  expect(edit).not.toHaveBeenCalled()
  expect(button('Reply').disabled).toBe(true)
  expect(host.querySelector('textarea')!.value).toBe('Agreed')
  act(() => inputValue(reply, 'Agreed.'))
  expect(button('Reply').disabled).toBe(false)
})
