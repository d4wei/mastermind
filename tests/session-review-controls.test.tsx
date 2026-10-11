// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useDoc } from '../src/ui/app/store'
import type { TextEdit } from '../src/shared/types'
import { analyzeMarkdown } from '../src/shared/markdown/analyze'
import { resolveThreadEdits, deleteCommentEdits } from '../src/shared/review-archive'
import { SessionView } from '../src/ui/app/SessionView'

const rail = vi.hoisted(() => ({ onEdit: null as null | ((edits: TextEdit[]) => void) }))
vi.mock('../src/ui/review/CommentRail', () => ({ CommentRail: (props: { onEdit: (edits: TextEdit[]) => void }) => {
  rail.onEdit = props.onEdit
  return <div data-testid="rail" />
} }))
vi.mock('../src/ui/app/ConflictPanel', () => ({ ConflictPanel: () => null }))
vi.mock('../src/ui/app/api', async (importOriginal) => ({ ...await importOriginal<object>(),
  openEvents: () => ({ addEventListener() {}, close() {} }),
}))
vi.mock('../src/ui/util/SlotLabel', () => ({ SlotLabel: ({ text }: { text: string }) => <span>{text}</span> }))
let host: HTMLDivElement
let root: Root
const initial = useDoc.getState()

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useDoc.setState({ ...initial, sessionId: 'A', status: 'ready', source: 'body', savedSource: 'body',
    load: vi.fn().mockResolvedValue(undefined), meta: null })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); useDoc.setState(initial)
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals()
})
function render(source: string) {
  useDoc.setState({ source, savedSource: source })
  act(() => root.render(<SessionView sessionId="A" />))
}

it.each(['plain body', '{>>live note<<}', '<!-- mastermind:resolved-thread v99\nunknown\n-->'])(
  'keeps Resolved reachable for %j', (source) => {
    render(source)
    const button = host.querySelector<HTMLButtonElement>('.topbar-resolved')!
    expect(button.textContent).toBe('Resolved (0)')
    expect(button.disabled).toBe(false)
    act(() => button.click())
    expect(host.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Resolved (0)')
  },
)
it.each(['resolve', 'delete'])('ignores stale double %s and callbacks captured before navigation', (action) => {
  const source = '{>>first<<}{>>second<<}'
  render(source)
  const callback = rail.onEdit!
  const thread = analyzeMarkdown(source).items.find((item) => item.type === 'thread')!
  if (thread.type !== 'thread') throw new Error('Expected thread')
  const edits = action === 'resolve' ? resolveThreadEdits(source, thread) : deleteCommentEdits(source, thread, 0)
  act(() => { callback(edits); callback(edits) })
  const resolved = useDoc.getState().source
  if (action === 'resolve') expect(resolved.match(/<!-- mastermind:resolved-thread/g)).toHaveLength(1)
  else expect(resolved).toBe('{>>second<<}')
  act(() => useDoc.setState({ sessionId: 'B', source, savedSource: source }))
  act(() => callback(edits))
  expect(useDoc.getState().source).toBe(source)
})

it('keeps resolved discussions and comparison mutually exclusive', () => {
  render('body')
  const resolved = host.querySelector<HTMLButtonElement>('.topbar-resolved')!
  act(() => resolved.click())
  expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  act(() => useDoc.setState({ conflictDraft: {
    open: true, base: 'body', local: 'body', localRevision: 0,
    diskContent: 'disk', diskVersion: 'v2', diskMtimeMs: 2,
    result: 'body', refreshing: false, error: null,
  } }))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  act(() => resolved.click())
  expect(useDoc.getState().conflictDraft!.open).toBe(false)
  expect(host.querySelector('[role="dialog"]')).not.toBeNull()
})
