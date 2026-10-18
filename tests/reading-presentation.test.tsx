// @vitest-environment jsdom
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { renderMarkdown } from './helpers/markdown'
import { createReactHost, removeReactHost } from './helpers/dom'
import { scrollToSpan } from '../ui/util/scroll'
import { themeTokens } from './helpers/themes'
import { DocumentScroll } from '../ui/app/DocumentScroll'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('uses one target per discussion and keeps code examples out of marker indexing', () => {
  const source = '`{>>example<<}`\n\n{==passage==}{>>@Alex: First<<}{>>@Sam: Reply<<}\n\n' +
    'Point.{>>@Alex: Unanchored<<}{>>@Sam: Second reply<<}\n\n{==Standalone==}'
  const { host } = renderMarkdown(source)
  expect(host.querySelectorAll('.critic-anchor')).toHaveLength(1)
  expect(host.querySelector('.critic-anchor')?.textContent).toBe('passage')
  expect(host.querySelectorAll('.critic-comment-marker')).toHaveLength(1)
  expect(host.querySelector('.critic-comment-marker')?.getAttribute('aria-label')).toContain('Unanchored')
  expect(host.querySelectorAll('.critic-comment-reference')).toHaveLength(3)
  expect(host.textContent).toContain('Standalone')
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  for (const reference of host.querySelectorAll<HTMLElement>('.critic-comment-reference')) {
    const target = scrollToSpan({ current: host }, Number(reference.dataset.spanIndex))
    expect(target?.matches('.critic-anchor, .critic-comment-marker')).toBe(true)
    expect(target?.getAttribute('data-span-index')).toBe(reference.dataset.commentTarget)
  }
  scroll.mockRestore()
})

it('reveals the scrollbar during scrolling or edge pointing and hides it after idle', () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const { root, host } = createReactHost()
  act(() => root.render(<DocumentScroll>Document</DocumentScroll>))
  const scroll = host.querySelector<HTMLElement>('.document-scroll')!
  expect(scroll.dataset.scrollActive).toBe('false')
  act(() => scroll.dispatchEvent(new Event('scroll', { bubbles: true })))
  expect(scroll.dataset.scrollActive).toBe('true')
  act(() => vi.advanceTimersByTime(1000))
  expect(scroll.dataset.scrollActive).toBe('false')
  scroll.getBoundingClientRect = () => ({ right: 800 } as DOMRect)
  act(() => scroll.dispatchEvent(new MouseEvent('pointermove', { clientX: 796, bubbles: true })))
  expect(scroll.dataset.scrollActive).toBe('true')
  act(() => scroll.dispatchEvent(new MouseEvent('pointermove', { clientX: 600, bubbles: true })))
  expect(scroll.dataset.scrollActive).toBe('false')
  removeReactHost(root, host)
})

it('uses equal prose gaps, body-relative headings, and tight nested list margins', () => {
  const tokens = themeTokens('grid')
  const style = document.createElement('style')
  style.textContent = readFileSync('ui/app/app.css', 'utf8')
    .replace(/var\((--md-[a-z0-9-]+)\)/g, (_, name: string) => tokens[name]!)
    .replaceAll('var(--font-size-body)', '16px')
  document.head.append(style)
  const { host } = renderMarkdown('# Title\n\nParagraph.\n\n- Item\n  - Nested\n\n> Quote\n\n```\nCode\n```')
  host.className = 'md-root'
  document.body.append(host)
  try {
    for (const element of host.querySelectorAll(':scope > p, :scope > ul, blockquote, pre')) {
      expect(getComputedStyle(element).marginBottom).toBe(element === host.lastElementChild ? '0px' : '16px')
    }
    expect(getComputedStyle(host.querySelector('h1')!).fontSize).toBe('2em')
    host.classList.add('trans-block-body')
    expect(getComputedStyle(host.querySelector('pre')!).marginBottom).toBe('16px')
    expect(getComputedStyle(host.querySelector('li > ul')!).marginBlock).toBe('0px')
    host.classList.remove('trans-block-body')
    host.innerHTML = renderMarkdown('---\nstatus: draft\n---\n# Title\n\n- One\n\n- Two').host.innerHTML
    expect(getComputedStyle(host.querySelector('h1')!).marginTop).toBe('0px')
    expect(getComputedStyle(host.querySelectorAll('li')[1]!).marginTop).toBe('16px')
  } finally { style.remove(); host.remove() }
})
