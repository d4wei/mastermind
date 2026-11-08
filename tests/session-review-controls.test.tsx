// @vitest-environment jsdom
import { openReaderMenu, readerMenuItem } from './helpers/reader-menu'
import { installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useDoc } from '../ui/documents/store'
import { requestFind, useOverlay } from '../ui/app/overlayStore'
import type { TextEdit } from '../document/types'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { resolveThreadEdits, deleteCommentEdits } from '../document/review-archive'
import { applyTextEdits } from '../document/edits'
import { SessionView } from '../ui/app/SessionView'
import { releaseDrafts, useDrafts } from '../ui/review/drafts'
import { threadRef, type ReplyDraft } from '../ui/review/thread-identity'
import { useTranslation } from '../ui/translate/translationStore'
import { prepareTranslation } from '../document/translation'

const rail = vi.hoisted(() => ({ leaving: false, request: null as { spanIndex: number } | null, active: null as number | null, hovered: null as number | null, onHover: null as null | ((span: number | null) => void), onEdit: null as null | ((edits: TextEdit[]) => void),
  drafts: [] as readonly ReplyDraft[], onDraftsChange: null as null | ((drafts: ReplyDraft[]) => void) }))
vi.mock('../ui/review/CommentRail', () => ({ CommentRail: (props: { leaving?: boolean; replyRequest?: { spanIndex: number } | null; onEdit: (edits: TextEdit[]) => void; activeSpan: number | null; hoveredSpan: number | null; onHover: (span: number | null) => void; drafts: readonly ReplyDraft[]; onDraftsChange: (drafts: ReplyDraft[]) => void }) => {
  rail.onEdit = props.onEdit
  rail.leaving = !!props.leaving
  rail.drafts = props.drafts
  rail.onDraftsChange = props.onDraftsChange
  rail.active = props.activeSpan
  rail.request = props.replyRequest ?? null
  rail.hovered = props.hoveredSpan
  rail.onHover = props.onHover
  return <div data-testid="rail" />
} }))
const toolbar = vi.hoisted(() => ({ onEdit: null as null | ((edits: TextEdit[]) => boolean) }))
vi.mock('../ui/modes/reading/SelectionToolbar', () => ({ SelectionToolbar: (props: { onEdit: (edits: TextEdit[]) => boolean }) => {
  toolbar.onEdit = props.onEdit
  return null
} }))
vi.mock('../ui/app/ConflictPanel', () => ({ ConflictPanel: () => null }))
const nav = vi.hoisted(() => ({ props: null as null | import('../ui/app/Navigator').NavigatorProps }))
vi.mock('../ui/app/Navigator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/app/Navigator')>()
  return { ...actual, Navigator: (props: import('../ui/app/Navigator').NavigatorProps) => {
    nav.props = props
    return <actual.Navigator {...props} />
  } }
})
let host: HTMLDivElement
let root: Root
const initial = useDoc.getState()

beforeEach(() => {
  installHost(fakeHost())
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
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); installHost(null)
})
function render(source: string) {
  useDoc.setState({ source, savedSource: source })
  act(() => root.render(<SessionView sessionId="A" />))
}

it.each(['plain body', '{>>live note<<}', '<!-- mastermind:resolved-thread v99\nunknown\n-->'])(
  'keeps Resolved reachable for %j', (source) => {
    render(source)
    openReaderMenu(host)
    const button = readerMenuItem('Resolved (0)')
    expect(button.textContent).toBe('Resolved (0)')
    expect(button.getAttribute('aria-disabled')).not.toBe('true')
    act(() => button.click())
    expect(host.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Resolved discussions (0)')
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

it('holds the overflow menu in the shared top-right overlay, closing Find and yielding to its panels', () => {
  render('body')
  act(() => requestFind())
  openReaderMenu(host)
  expect(useOverlay.getState()).toMatchObject({ open: 'menu', owner: 'A' })
  act(() => readerMenuItem('Resolved (0)').click())
  expect(useOverlay.getState()).toMatchObject({ open: 'resolved', owner: 'A' })
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Resolved discussions (0)')
})

it('keeps resolved discussions available while a conflict pauses edits', () => {
  render('body')
  openReaderMenu(host)
  act(() => readerMenuItem('Resolved (0)').click())
  act(() => useDoc.setState({ recovery: 'changed' }))
  expect(host.querySelector('[role="dialog"]')).not.toBeNull()
})

it.each([false, true])('deletes a resolved discussion through the review edit path, paused: %s', (paused) => {
  const live = 'Text {>>@Alex: note<<}\n'
  const thread = analyzeMarkdown(live).items.find((item) => item.type === 'thread')!
  if (thread.type !== 'thread') throw new Error('Expected thread')
  const source = applyTextEdits(live, resolveThreadEdits(live, thread))
  render(source)
  openReaderMenu(host)
  act(() => readerMenuItem('Resolved (1)').click())
  if (paused) act(() => useDoc.setState({ recovery: 'changed' }))
  const trigger = host.querySelector<HTMLButtonElement>('.resolved-card [aria-label="More"]')!
  act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  const item = readerMenuItem('Delete discussion')
  act(() => item.click())
  if (paused) {
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(useDoc.getState().source).toBe(source)
    return
  }
  expect(useDoc.getState().source).toBe('Text \n')
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Resolved discussions (0)')
  act(() => useDoc.getState().undo())
  expect(useDoc.getState().source).toBe(source)
})

it('opens narrow-screen comments in a dismissible panel without reserving a side column', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  render('{>>@Alex: a note<<}')
  expect(host.querySelector('[data-testid="rail"]')).toBeNull()
  const toggle = host.querySelector<HTMLButtonElement>('.topbar-comments')!
  act(() => toggle.click())
  expect(host.querySelector('.doc-shell')?.classList.contains('with-rail')).toBe(false)
  const panel = host.querySelector('[role="dialog"]')!
  expect(panel.getAttribute('aria-label')).toBe('Comments')
  expect(panel.closest('.document-scroll')).toBeNull()
  expect(panel.querySelector('[data-testid="rail"]')).not.toBeNull()
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
})

it.each(['pointer', 'keyboard'])('opens comments exclusively from a narrow-screen marker using %s', (input) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  render('{>>@Alex: a note<<}')
  openReaderMenu(host)
  act(() => readerMenuItem('Resolved (0)').click())
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Resolved discussions (0)')
  const marker = host.querySelector<HTMLElement>('.critic-comment-marker')!
  act(() => {
    if (input === 'pointer') marker.click()
    else marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  expect(rail.request).toEqual({ spanIndex: 0 })
  expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Comments')
})

it('scrolls the article and wide comment rail together, with controls and panels outside', () => {
  render('# Heading\n\nText {>>@Alex: note<<}')
  const viewport = host.querySelector('.document-scroll')!
  expect(viewport.querySelector('article')).not.toBeNull()
  expect(viewport.querySelector('[data-testid="rail"]')).not.toBeNull()
  expect(viewport.querySelector('.topbar')).toBeNull()
  act(() => host.querySelector('article p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expect(host.querySelector('.block-actions')).toBeNull()
  openReaderMenu(host)
  act(() => readerMenuItem('Resolved (0)').click())
  expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  expect(viewport.querySelector('[role="dialog"]')).toBeNull()
})

it('fades the wide rail out in place before the document recenters, and shows it again at once', () => {
  render('Text {>>@Alex: note<<}')
  const shell = () => host.querySelector('.doc-shell')!
  const toggle = host.querySelector<HTMLButtonElement>('.topbar-comments')!
  expect(rail.leaving).toBe(false)
  act(() => toggle.click())
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  expect(host.querySelector('[data-testid="rail"]')).not.toBeNull()
  expect(rail.leaving).toBe(true)
  expect(shell().classList.contains('with-rail')).toBe(true)
  act(() => vi.advanceTimersByTime(120))
  expect(host.querySelector('[data-testid="rail"]')).toBeNull()
  expect(shell().classList.contains('with-rail')).toBe(false)
  act(() => toggle.click())
  expect(host.querySelector('[data-testid="rail"]')).not.toBeNull()
  expect(rail.leaving).toBe(false)
  expect(shell().classList.contains('with-rail')).toBe(true)
  // Showing again before the fade ends keeps the same rail and cancels its exit.
  act(() => toggle.click())
  act(() => vi.advanceTimersByTime(60))
  act(() => toggle.click())
  expect(rail.leaving).toBe(false)
  act(() => vi.advanceTimersByTime(120))
  expect(host.querySelector('[data-testid="rail"]')).not.toBeNull()
})

it.each(['reduced motion', 'Markdown mode'])('removes the wide rail at once for %s', (cause) => {
  if (cause === 'reduced motion') {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion'),
      addEventListener() {}, removeEventListener() {} }))
  }
  render('Text {>>@Alex: note<<}')
  expect(host.querySelector('[data-testid="rail"]')).not.toBeNull()
  if (cause === 'reduced motion') act(() => host.querySelector<HTMLButtonElement>('.topbar-comments')!.click())
  else act(() => useDoc.getState().setMode('source'))
  expect(host.querySelector('[data-testid="rail"]')).toBeNull()
  expect(host.querySelector('.doc-shell')?.classList.contains('with-rail')).toBe(false)
})

it('pairs passage and card hover without selecting a discussion', () => {
  render('Before {==passage==}{>>@Alex: note<<} after.')
  const passage = host.querySelector<HTMLElement>('.critic-anchor')!
  act(() => passage.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
  expect(rail.hovered).toBe(0)
  expect(rail.active).toBeNull()
  expect(passage.classList.contains('paired')).toBe(true)
  act(() => rail.onHover!(null))
  expect(passage.classList.contains('paired')).toBe(false)
  act(() => rail.onHover!(0))
  expect(passage.classList.contains('paired')).toBe(true)
  expect(rail.active).toBeNull()
})

it('selects from the passage and clears selection on ordinary document clicks or Escape', () => {
  render('Before {==passage==}{>>@Alex: note<<} after.')
  const passage = host.querySelector<HTMLElement>('.critic-anchor')!
  act(() => passage.click())
  expect(rail.active).toBe(0)
  act(() => passage.click())
  expect(rail.active).toBe(0)
  act(() => host.querySelector('article p')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(rail.active).toBeNull()
  act(() => passage.click())
  expect(rail.active).toBe(0)
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(rail.active).toBeNull()
})

it('deselects on a click anywhere but the selected card, a passage, or UI the card opened', () => {
  render('Before {==passage==}{>>@Alex: note<<} after.')
  const passage = host.querySelector<HTMLElement>('.critic-anchor')!
  const select = () => { act(() => passage.click()); expect(rail.active).toBe(0) }
  const clickOn = (element: Element, init: MouseEventInit = {}) =>
    act(() => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...init })) })
  const add = (html: string): HTMLElement => {
    const holder = document.createElement('div')
    holder.innerHTML = html
    host.append(holder)
    return holder.querySelector<HTMLElement>('[data-target]')!
  }
  const card = add('<div class="rail-card active"><div class="rail-reply"><textarea data-target></textarea></div></div>')
  const menu = add('<div data-radix-popper-content-wrapper><div role="menu"><div role="menuitem" data-target>Delete</div></div></div>')
  const dialog = add('<div class="slide-over" role="dialog"><p data-target>Settings</p></div>')
  const narrowRail = add('<div class="comments-panel"><div class="slide-over" role="dialog"><div class="rail" data-target></div></div></div>')
  select()
  for (const kept of [card, menu, dialog, passage]) {
    clickOn(kept)
    expect(rail.active).toBe(0)
  }
  for (const elsewhere of [host.querySelector('.topbar')!, host.querySelector('[data-testid="rail"]')!,
    host.querySelector('.doc-shell')!, narrowRail]) {
    select()
    clickOn(elsewhere)
    expect(rail.active).toBeNull()
  }
})

it('keeps the selected discussion through a drag or a text selection that ends in a click', () => {
  render('Before {==passage==}{>>@Alex: note<<} after.')
  act(() => host.querySelector<HTMLElement>('.critic-anchor')!.click())
  const paragraph = host.querySelector('article p')!
  act(() => {
    paragraph.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
    paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 80, clientY: 10 }))
  })
  expect(rail.active).toBe(0)
  const text = paragraph.firstChild!.firstChild!
  window.getSelection()!.setBaseAndExtent(text, 0, text, 3)
  act(() => { paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(rail.active).toBe(0)
  window.getSelection()!.removeAllRanges()
  act(() => { paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(rail.active).toBeNull()
})

it('keeps the selected discussion when an edit inserts an earlier one, and forgets it once resolved', () => {
  render('a {==X==}{>>x<<} b {==Y==}{>>y<<}')
  act(() => host.querySelector<HTMLElement>('.critic-anchor[data-span-index="2"]')!.click())
  expect(rail.active).toBe(2)
  act(() => useDoc.getState().applyEdits([{ from: 0, to: 0, insert: '{>>new<<} ' }]))
  expect(host.querySelector('.critic-anchor.active')?.textContent).toBe('Y')
  expect(rail.active).toBe(3)
  const source = useDoc.getState().source
  const y = analyzeMarkdown(source).items.filter((item) => item.type === 'thread')[2]!
  if (y.type !== 'thread') throw new Error('Expected thread')
  act(() => rail.onEdit!(resolveThreadEdits(source, y)))
  expect(rail.active).toBeNull()
  expect(host.querySelector('.critic-anchor.active')).toBeNull()
})

it('keeps the selected discussion when Escape closes a panel', () => {
  render('a {==X==}{>>x<<}')
  act(() => host.querySelector<HTMLElement>('.critic-anchor')!.click())
  expect(rail.active).toBe(0)
  openReaderMenu(host)
  act(() => readerMenuItem('Resolved (0)').click())
  expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(rail.active).toBe(0)
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(rail.active).toBeNull()
})

it('rebases the selection and reply drafts exactly through edits made in the document', () => {
  const discussion = '{==t==}{>>@bo: same<<}'
  const source = `{--a--} ${discussion} {--b--} ${discussion}`
  render(source)
  act(() => host.querySelector<HTMLElement>('.critic-anchor[data-span-index="1"]')!.click())
  expect(rail.active).toBe(1)
  const cards = analyzeMarkdown(source).threads
  act(() => rail.onDraftsChange!([{ id: 1, thread: threadRef(cards[0]!, source, cards), text: 'mine' }]))
  // Each deletion rejected from the article; together they span the first discussion.
  act(() => host.querySelector<HTMLElement>('.critic-del')!.click())
  act(() => host.querySelector<HTMLElement>('.critic-del')!.click())
  const edited = useDoc.getState().source
  expect(edited).toBe(`a ${discussion} b ${discussion}`)
  expect(rail.active).toBe(0)
  expect(rail.drafts.map((draft) => draft.thread && [draft.thread.source, draft.thread.start])).toEqual([[edited, 2]])
})

it('orphans a reply draft rather than move it to a lookalike added while the rail was closed', () => {
  const discussion = '{==teh==}{>>@me: typo<<}'
  const source = `Para one ${discussion} end.\n\nPara two teh here.\n`
  render(source)
  const cards = analyzeMarkdown(source).threads
  act(() => rail.onDraftsChange!([{ id: 1, thread: threadRef(cards[0]!, source, cards), text: 'my reply' }]))
  act(() => host.querySelector<HTMLButtonElement>('.topbar-comments')!.click())
  act(() => vi.advanceTimersByTime(120))
  expect(host.querySelector('[data-testid="rail"]')).toBeNull()
  try {
    const at = source.indexOf('teh here')
    act(() => { expect(toolbar.onEdit!([{ from: at, to: at + 3, insert: discussion }])).toBe(true) })
    // An external change removes the original discussion, leaving only its lookalike.
    const external = useDoc.getState().source.replace(`Para one ${discussion} end.`, 'Para one teh end.')
    act(() => useDoc.setState({ source: external, savedSource: external }))
    const drafts = useDrafts.getState().documents.get('A')!.values.get('replies') as ReplyDraft[]
    expect(drafts.map((draft) => [draft.thread, draft.text])).toEqual([[null, 'my reply']])
  } finally { releaseDrafts('A') }
})

it('keeps the selected discussion when Escape closes the outline popover', () => {
  useDoc.setState({ source: '# One\n\nBefore {==passage==}{>>@Alex: note<<}\n\n# Two\n' })
  act(() => root.render(<SessionView sessionId="A" />))
  act(() => host.querySelector<HTMLElement>('.critic-anchor')!.click())
  expect(rail.active).toBe(0)
  act(() => host.querySelector<HTMLButtonElement>('.outline-progress')!.focus())
  expect(host.querySelector('.outline-popover')).not.toBeNull()
  const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
  act(() => window.dispatchEvent(escape))
  expect(escape.defaultPrevented).toBe(true)
  expect(host.querySelector('.outline-popover')).toBeNull()
  expect(rail.active).toBe(0)
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(rail.active).toBeNull()
})

it('navigates the outline within the translated view', async () => {
  vi.useRealTimers()
  const { webcrypto } = await import('node:crypto')
  vi.stubGlobal('crypto', webcrypto)
  const source = '# One\n\ntext\n\n# Two\n\nmore'
  const prepared = await prepareTranslation(source)
  const artifact = { version: 1, sourceHash: prepared.sourceHash, sourceLang: 'en', targetLang: 'fr',
    blocks: prepared.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id,
      // The first paragraph's emphasis starts at the second heading's source offset.
      text: block.kind === 'heading' ? `${block.text} (fr)` : block.text === 'text' ? 'texte tradui *ici*' : block.text })) }
  installHost(fakeHost({ translations: async () => [artifact] }))
  render(source)
  try {
    await act(async () => { await useTranslation.getState().select('fr') })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(host.querySelector('.trans-view [data-ps]')).not.toBeNull()
    })
    const { outline, docEl } = nav.props!
    expect(docEl).toBe(host.querySelector('.trans-view'))
    expect(outline.map((item) => docEl!.querySelector(`[data-ps="${item.offset}"]`)?.textContent))
      .toEqual(['One (fr)', 'Two (fr)'])
  } finally { useTranslation.getState().release('A') }
})
