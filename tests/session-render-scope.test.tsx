// @vitest-environment jsdom
import { installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDoc } from '../ui/documents/store'
import { useOverlay } from '../ui/app/overlayStore'
import { SessionView } from '../ui/app/SessionView'
import { inputValue } from './helpers/dom'
import { scrollDocument, stubDocumentLayout, type DocumentLayout } from './helpers/layout'

const counts = vi.hoisted(() => ({ document: 0, analyses: 0, messages: new Map<number, number>() }))
vi.mock('../ui/review/ThreadMessage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/review/ThreadMessage')>()
  return { ThreadMessage: (props: Parameters<typeof actual.ThreadMessage>[0] & { 'data-find-comment'?: number }) => {
    const span = props['data-find-comment']!
    counts.messages.set(span, (counts.messages.get(span) ?? 0) + 1)
    return <actual.ThreadMessage {...props} />
  } }
})
// The document view sections its blocks once per render.
vi.mock('../ui/modes/reading/callouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/modes/reading/callouts')>()
  return { ...actual, calloutSections: (...args: Parameters<typeof actual.calloutSections>) => {
    counts.document++
    return actual.calloutSections(...args)
  } }
})
vi.mock('../document/markdown/analyze', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../document/markdown/analyze')>()
  return { ...actual, analyzeMarkdown: (source: string) => {
    counts.analyses++
    return actual.analyzeMarkdown(source)
  } }
})
vi.mock('../ui/app/ConflictPanel', () => ({ ConflictPanel: () => null }))

const SOURCE = [
  '# Notes', '', 'First {==alpha==}{>>@a: one<<} text.', '', 'Second {==beta==}{>>@b: two<<} text.', '',
  'Third {==gamma==}{>>@c: three<<} text.', '', '- [ ] a task', '',
].join('\n')

let host: HTMLDivElement
let root: Root
const initial = useDoc.getState()
/** Each discussion's anchor sits 1,000 px below the one before it. */
let layout: DocumentLayout
let restoreLayout: () => void

beforeEach(() => {
  installHost(fakeHost())
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  layout = { viewport: 10_000, cardHeight: () => 50, anchorTop: (anchor) => 1000 * Math.max(0, anchors().indexOf(anchor)) }
  restoreLayout = stubDocumentLayout(layout)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useOverlay.setState({ open: null, owner: null, viewCommand: null })
  useDoc.setState({ ...initial, sessionId: 'A', status: 'ready', mode: 'reading', source: SOURCE, savedSource: SOURCE,
    load: vi.fn().mockResolvedValue(undefined), meta: null })
  act(() => root.render(<SessionView sessionId="A" />))
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); useDoc.setState(initial)
  restoreLayout()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); installHost(null)
})

const anchors = () => [...host.querySelectorAll<HTMLElement>('article .critic-anchor')]
/** What rendered since the last call: the document's renders, and the cards by their opening message. */
function rendered(): { document: number; cards: number[] } {
  const openers = [...host.querySelectorAll<HTMLElement>('.rail-card')]
    .map((card) => Number(card.querySelector<HTMLElement>('[data-find-comment]')!.dataset.findComment))
  const result = { document: counts.document, cards: openers.filter((span) => counts.messages.has(span)) }
  counts.messages.clear()
  counts.document = 0
  return result
}
const hover = (element: HTMLElement) => act(() => { element.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })) })

it('re-renders only the cards a hover or selection changes, never the document', () => {
  expect(host.querySelectorAll('.rail-card')).toHaveLength(3)
  rendered()
  const [first, second] = anchors()
  hover(first!)
  expect(host.querySelectorAll('.rail-card.paired')).toHaveLength(1)
  expect(rendered()).toEqual({ document: 0, cards: [expect.any(Number)] })
  hover(second!)
  expect(rendered()).toMatchObject({ document: 0, cards: { length: 2 } })
  act(() => second!.click())
  expect(host.querySelector('.rail-card.active')).not.toBeNull()
  const selected = rendered()
  expect(selected.document).toBe(0)
  expect(selected.cards.length).toBeLessThanOrEqual(2)
})

it('re-renders only the composing card while a reply is typed, and task checkboxes edit the current source', () => {
  act(() => anchors()[1]!.click())
  rendered()
  const reply = host.querySelector<HTMLTextAreaElement>('.rail-card.active textarea')!
  act(() => inputValue(reply, 'Agreed'))
  expect(rendered()).toEqual({ document: 0, cards: [expect.any(Number)] })
  act(() => host.querySelector<HTMLInputElement>('.task-checkbox')!.click())
  expect(useDoc.getState().source).toBe(SOURCE.replace('- [ ]', '- [x]'))
  act(() => host.querySelector<HTMLInputElement>('.task-checkbox')!.click())
  expect(useDoc.getState().source).toBe(SOURCE)
})

it('reuses the analysis of an unchanged source across mode switches', async () => {
  counts.analyses = 0
  await act(async () => useDoc.getState().setMode('source'))
  await act(async () => useDoc.getState().setMode('reading'))
  expect(counts.analyses).toBe(0)
  expect(host.querySelectorAll('.rail-card')).toHaveLength(3)
})

it('mounts Find on its first shortcut and opens it', async () => {
  expect(host.querySelector('.find-bar')).toBeNull()
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true })) })
  for (let attempt = 0; attempt < 50 && !host.ownerDocument.querySelector('.find-bar'); attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  expect(host.ownerDocument.querySelector('.find-bar')).not.toBeNull()
  expect(useOverlay.getState().open).toBe('find')
})

it('renders only the cards entering a window change, never the ones that stay or the document', async () => {
  const scroller = host.querySelector<HTMLElement>('.document-scroll')!
  const openers = () => [...host.querySelectorAll<HTMLElement>('.rail-card [data-find-comment]')]
    .map((message) => Number(message.dataset.findComment))
  const [first, second, third] = openers()
  expect(openers()).toHaveLength(3)
  rendered()
  // A 400 px viewport with its margins reaches the second anchor at 1,000 px, not the third.
  layout.viewport = 400
  await act(() => scrollDocument(scroller, 0))
  expect(openers()).toEqual([first, second])
  expect(rendered()).toEqual({ document: 0, cards: [] })
  await act(() => scrollDocument(scroller, 2000))
  // A draft an earlier test left on the second card may keep it mounted.
  expect(openers()).toContain(third)
  expect(openers()).not.toContain(first)
  expect(rendered()).toEqual({ document: 0, cards: [third] })
})
