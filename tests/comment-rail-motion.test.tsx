// @vitest-environment jsdom
import { act, useMemo, useRef, useState, type RefObject } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { CommentRail } from '../ui/review/CommentRail'
import type { ReplyDraft } from '../ui/review/thread-identity'
import { createReactHost, inputValue, removeReactHost } from './helpers/dom'

const SOURCE = '{==alpha==}{>>@a: one<<} text {==beta==}{>>@b: two<<}{>>@c: a reply<<}\n'

let host: HTMLDivElement
let root: Root
/** Each card's rendered height, by its order in the rail. */
let heights: number[]
let resize: (() => void) | null
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() {} })
  document.documentElement.style.setProperty('--dur-base', '180ms')
  heights = [100, 50]
  resize = null
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = [...document.querySelectorAll('.rail-card')].indexOf(this)
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0, height: heights[index] ?? 0, toJSON: () => ({}) }
  })
  // jsdom does not implement inert; browsers refuse focus inside it.
  const focus = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
    if (!this.closest('[inert]')) focus.call(this, options)
  })
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  document.documentElement.style.removeProperty('--dur-base')
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function Harness({ detached = false }: { detached?: boolean }) {
  const analysis = useMemo(() => analyzeMarkdown(SOURCE), [])
  const docRef = useRef<HTMLElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<ReplyDraft[]>([])
  return <><article ref={detached ? undefined : docRef} />
    <CommentRail source={SOURCE} analysis={analysis} docRef={docRef as RefObject<HTMLElement | null>} authorTag="reviewer"
      activeSpan={active} onActivate={setActive} onEdit={() => true} drafts={drafts} onDraftsChange={setDrafts} /></>
}
const cards = () => [...host.querySelectorAll<HTMLElement>('.rail-card')]
const open = (index: number) => act(() => cards()[index]!.querySelector<HTMLButtonElement>('.rail-select')!.click())
const escape = () => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })

it('keeps an unplaced card unseen rather than at the top of the rail', () => {
  act(() => root.render(<Harness detached />))
  expect(cards().map((card) => card.classList.contains('unplaced'))).toEqual([true, true])
  expect(cards().map((card) => card.style.top)).toEqual(['', ''])
})

it('moves neighbors within the size observer callback, before the frame paints', () => {
  act(() => root.render(<Harness />))
  expect(cards().map((card) => card.classList.contains('unplaced'))).toEqual([false, false])
  expect(cards().map((card) => card.style.top)).toEqual(['0px', '108px'])
  heights = [160, 50]
  // Outside act, so only a synchronous commit can show the new placement on return.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
  resize!()
  expect(cards()[1]!.style.top).toBe('168px')
})

it('keeps a collapsing reply field mounted but inert, and focuses it when reopened mid-collapse', () => {
  act(() => root.render(<Harness />))
  open(0)
  const input = cards()[0]!.querySelector('textarea')!
  expect(document.activeElement).toBe(input)
  escape()
  expect(cards()[0]!.querySelector('textarea')).toBe(input)
  expect(input.closest('[inert]')).not.toBeNull()
  expect(input.closest('[aria-hidden="true"]')).not.toBeNull()
  expect(document.activeElement).toBe(cards()[0]!.querySelector('.rail-select'))
  open(0)
  expect(input.closest('[inert]')).toBeNull()
  expect(document.activeElement).toBe(input)
  act(() => vi.advanceTimersByTime(500))
  expect(cards()[0]!.querySelector('textarea')).toBe(input)
})

it('leaves with the collapse when selection moves to another card, without the open composer\'s state', () => {
  act(() => root.render(<Harness />))
  open(0)
  act(() => inputValue(cards()[0]!.querySelector('textarea')!, 'A reply'))
  act(() => vi.advanceTimersByTime(0))
  expect(cards()[0]!.querySelector<HTMLButtonElement>('.btn-primary')!.disabled).toBe(false)
  open(1)
  const leaving = cards()[0]!.querySelector('.rail-reply')!
  expect(leaving.closest('[inert]')).not.toBeNull()
  expect(leaving.querySelector<HTMLButtonElement>('.btn-primary')!.disabled).toBe(true)
  expect(document.activeElement).toBe(cards()[1]!.querySelector('textarea'))
  act(() => vi.advanceTimersByTime(180))
  expect(cards()[0]!.querySelector('.rail-reply')).toBeNull()
})
