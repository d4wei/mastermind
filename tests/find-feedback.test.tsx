// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FindPanel } from '../ui/find/FindPanel'
import { stubHighlights } from './helpers/dom'
import { openOverlay, requestFind, useOverlay } from '../ui/app/overlayStore'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { useConfig } from '../ui/app/configStore'

let host: HTMLDivElement
let root: Root
let serial = 0
const highlights = new Map<string, Set<Range>>()
const close = vi.fn(), reveal = vi.fn()

function Harness({ text = 'Review the proposal. Review it again.', source = '', id = `find-${serial}` }: { text?: string; source?: string; id?: string }) {
  const docRef = useRef<HTMLElement>(null)
  return <div className="app-content"><button onClick={requestFind}>Find</button>
    <div className="document-scroll"><article ref={docRef}><h1>A proposal</h1><p>{text}</p></article></div>
    <FindPanel sessionId={id} source={source} mode="reading" docRef={docRef}
      analysis={source ? analyzeMarkdown(source) : null} onClose={close} onRevealComment={reveal} />
  </div>
}
const input = () => host.querySelector<HTMLInputElement>('input')!
const key = (value: string, options: KeyboardEventInit = {}) => act(() => {
  (document.activeElement ?? window).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, ...options }))
})
const fill = (value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
  input().dispatchEvent(new Event('input', { bubbles: true }))
})
const click = (label: string) => act(() => {
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()
})

beforeEach(() => {
  serial++
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  stubHighlights(highlights)
  Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 120 } as DOMRect)
  useConfig.setState({ config: { ...useConfig.getState().config!, uiLang: 'en' } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<Harness />))
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); highlights.clear()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks()
})

it('opens from the visible entry and repeated Command-F refocuses without closing or matching an empty query', () => {
  act(() => host.querySelector('button')!.click())
  expect(document.activeElement).toBe(input())
  expect(highlights.get('find-results')?.size).toBe(0)
  expect(host.querySelector('[role="status"]')?.textContent).toBe('')
  fill('Review')
  key('f', { metaKey: true })
  expect(input().value).toBe('Review')
  expect(input().selectionStart).toBe(0)
  expect(input().selectionEnd).toBe(6)
  expect(host.querySelector('[role="search"]')).not.toBeNull()
})

it('counts individual body occurrences, wraps, toggles case, and clears highlights for empty/no results and close', () => {
  key('f', { ctrlKey: true }); fill('review')
  expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 2')
  expect(highlights.get('find-results')?.size).toBe(2)
  click('Next result')
  expect(host.querySelector('[role="status"]')?.textContent).toBe('2 of 2')
  key('Enter')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('1 of 2 · Search wrapped')
  key('g', { metaKey: true, shiftKey: true })
  expect(host.querySelector('[role="status"]')?.textContent).toContain('2 of 2')
  click('Match case')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('No results')
  expect(highlights.get('find-results')?.size).toBe(0)
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Next result"]')!.disabled).toBe(true)
  fill(''); expect(highlights.get('find-current')?.size).toBe(0)
  key('Escape'); expect(host.querySelector('[role="search"]')).toBeNull()
  expect(highlights.size).toBe(0)
})

it('closes when another overlay opens, but not for one already open when it mounts', () => {
  act(() => openOverlay('settings', 'doc'))
  act(() => root.render(<Harness key="retained" />))
  key('f', { metaKey: true }); expect(useOverlay.getState().open).toBe('find')
  act(() => root.render(<Harness key="other" id={`other-${serial}`} />))
  act(() => openOverlay('language', 'doc'))
  act(() => root.render(<Harness key="retained" />))
  expect(host.querySelector('[role="search"]')).not.toBeNull()
  act(() => openOverlay('files'))
  expect(host.querySelector('[role="search"]')).toBeNull()
})

it('closes when the document overflow menu opens in the same region', () => {
  key('f', { metaKey: true }); expect(host.querySelector('[role="search"]')).not.toBeNull()
  act(() => openOverlay('menu', 'doc'))
  expect(host.querySelector('[role="search"]')).toBeNull()
})

it('does not navigate or close while confirming IME composition', () => {
  key('f', { metaKey: true }); fill('Review')
  act(() => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  fill('review')
  key('Enter'); key('Escape')
  expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 2')
  expect(host.querySelector('[role="search"]')).not.toBeNull()
  act(() => input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  key('Enter', { keyCode: 229 })
  expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 2')
  key('Enter'); expect(host.querySelector('[role="status"]')?.textContent).toBe('2 of 2')
})

it.each([
  ['en', '10 of 12', 'No results'], ['zh-CN', '第 10 项，共 12 项', '无结果'],
] as const)('shows a compact counter inside the field and announces the full phrase in %s', (uiLang, announced, none) => {
  act(() => {
    useConfig.setState({ config: { ...useConfig.getState().config!, uiLang } })
    root.render(<Harness text={'Review '.repeat(12)} />)
  })
  key('f', { metaKey: true })
  const counter = () => host.querySelector('.find-count')
  expect(counter()).toBeNull()
  fill('Review')
  expect(counter()!.parentElement).toBe(input().parentElement)
  expect(counter()!.getAttribute('aria-hidden')).toBe('true')
  expect(counter()!.textContent).toBe('1/12')
  for (let i = 0; i < 9; i++) key('Enter')
  expect(counter()!.textContent).toBe('10/12')
  expect(host.querySelector('[role="status"]')?.textContent).toBe(announced)
  fill('absent')
  expect(counter()!.textContent).toBe('0/0')
  expect(host.querySelector('[role="status"]')?.textContent).toBe(none)
})

it('recomputes after external content replacement without stealing field focus or retaining detached ranges', () => {
  key('f', { metaKey: true }); fill('Review')
  act(() => root.render(<Harness text="A replacement with no match." source="changed" />))
  expect(document.activeElement).toBe(input())
  expect(highlights.get('find-results')?.size).toBe(0)
  expect(host.querySelector('[role="status"]')?.textContent).toBe('No results')
})

it('leaves Escape to unrelated composers but closes Find from the source editor', () => {
  key('f', { metaKey: true })
  const composer = document.createElement('textarea')
  host.append(composer); composer.focus()
  key('Escape'); expect(host.querySelector('[role="search"]')).not.toBeNull()
  const editor = document.createElement('div')
  editor.className = 'cm-editor'; editor.contentEditable = 'true'; editor.tabIndex = 0
  host.append(editor); editor.focus()
  key('Escape'); expect(host.querySelector('[role="search"]')).toBeNull()
})

it('indexes collapsed comment replies and requests their thread without opening a composer', () => {
  const source = '{==Passage==}{>>@Alex: First note<<}{>>@Sam: Review this review<<}'
  act(() => root.render(<Harness text="Passage" source={source} />))
  key('f', { metaKey: true }); fill('review')
  expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 2')
  expect(reveal).toHaveBeenCalledWith(0)
  expect(host.querySelector('textarea')).toBeNull()
})

it('seeds a document selection and retains the query when reopened', () => {
  const range = document.createRange()
  range.selectNodeContents(host.querySelector('h1')!)
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
  key('f', { metaKey: true })
  expect(input().value).toBe('A proposal')
  fill('Review'); key('Escape')
  window.getSelection()!.removeAllRanges()
  key('f', { metaKey: true }); expect(input().value).toBe('Review')
})

it('searches the asynchronously rendered translation and visible discussions, excluding hidden original prose', async () => {
  const { webcrypto } = await import('node:crypto')
  vi.stubGlobal('crypto', webcrypto)
  const { prepareTranslation } = await import('../document/translation')
  const { TranslatedView } = await import('../ui/translate/TranslatedView')
  const original = '# Original heading\n\nOriginal body.\n\n{>>@Alex: Discussion text<<}\n'
  const prepared = await prepareTranslation(original)
  const artifact = { version: 1 as const, sourceHash: prepared.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: prepared.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id,
      text: block.kind === 'heading' ? '# 评审标题' : '评审正文。' })) }
  function TranslatedHarness() {
    const docRef = useRef<HTMLElement>(null)
    return <div className="app-content"><div className="document-scroll">
      <TranslatedView source={original} artifact={artifact} containerRef={docRef} />
      </div><FindPanel sessionId={`translated-${serial}`} source={original} mode="translated" docRef={docRef}
        analysis={analyzeMarkdown(original)} onClose={close} onRevealComment={reveal} /></div>
  }
  await act(async () => root.render(<TranslatedHarness />))
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(host.querySelector('.trans-view')).not.toBeNull()
  })
  key('f', { metaKey: true }); fill('评审')
  expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 2')
  expect([...highlights.get('find-results')!].map((range) => range.toString())).toEqual(['评审', '评审'])
  fill('Original'); expect(host.querySelector('[role="status"]')?.textContent).toBe('No results')
  fill('Discussion'); expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 1')
  expect(reveal).not.toHaveBeenCalled()
})


it('retains each document query, case setting, and open state without carrying another file highlights', () => {
  key('f', { metaKey: true }); fill('Review'); click('Match case')
  act(() => root.render(<Harness key="other" id={`other-${serial}`} text="Another file" />))
  expect(host.querySelector('[role="search"]')).toBeNull()
  expect(highlights.size).toBe(0)
  key('f', { metaKey: true }); fill('Another')
  act(() => root.render(<Harness key="original" />))
  expect(input().value).toBe('Review')
  expect(host.querySelector('[aria-label="Match case"]')!.getAttribute('aria-pressed')).toBe('true')
  expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 2')
})

it('draws Previous as the centered Next chevron turned half a revolution', async () => {
  const { readFileSync } = await import('node:fs')
  act(() => requestFind())
  const glyph = (label: string) => host.querySelector(`button[aria-label="${label}"] svg`)!
  const previous = glyph('Previous result'), next = glyph('Next result')
  expect(previous.innerHTML).toBe(next.innerHTML)
  expect(next.getAttribute('class')).toBe('find-nav-icon')
  expect(previous.getAttribute('class')).toBe('find-nav-icon find-previous-icon')
  const style = document.createElement('style')
  style.textContent = readFileSync('ui/find/find.css', 'utf8')
  document.head.append(style)
  try {
    const lift = getComputedStyle(next).transform
    expect(lift).toMatch(/^translateY\(.+\)$/)
    expect(getComputedStyle(previous).transform).toBe(`rotate(180deg) ${lift}`)
  } finally { style.remove() }
})

it('searches the indexed text again only after the document changes', async () => {
  const walks = () => matches.mock.calls.filter(([selector]) => String(selector).includes('.print-footnotes')).length
  const matches = vi.spyOn(Element.prototype, 'matches')
  key('f', { metaKey: true }); fill('Review')
  expect(walks()).toBeGreaterThan(0)
  matches.mockClear()
  fill('Review the'); click('Match case'); click('Next result')
  expect(walks()).toBe(0)
  expect(host.querySelector('[role="status"]')?.textContent).toMatch(/^1 of 1/)
  await act(async () => root.render(<Harness text="Review the review. Review the rest." />))
  expect(walks()).toBeGreaterThan(0)
  expect(host.querySelector('[role="status"]')?.textContent).toMatch(/of 2/)
})

it('waits for typing to pause before searching a one- or two-character query in a long document', () => {
  vi.useFakeTimers()
  try {
    const source = 'Review the proposal.\n\n' + 'filler '.repeat(20_000)
    act(() => root.render(<Harness source={source} />))
    key('f', { metaKey: true }); fill('Review')
    expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 2')
    fill('Re')
    expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 2')
    fill('Rx')
    expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 2')
    act(() => { vi.advanceTimersByTime(150) })
    expect(host.querySelector('[role="status"]')?.textContent).toBe('No results')
    fill('p')
    key('Enter')
    expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 4')
    fill('pro')
    expect(host.querySelector('[role="status"]')?.textContent).toBe('1 of 2')
  } finally { vi.useRealTimers() }
})
