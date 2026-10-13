// @vitest-environment jsdom
import { Tooltip } from 'radix-ui'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ClientConfig } from '../src/shared/types'
import { useConfig } from '../src/ui/app/configStore'
import { ConflictPanel } from '../src/ui/app/ConflictPanel'
import { createDocStore, useDoc } from '../src/ui/app/store'
import { Navigator } from '../src/ui/app/Navigator'
import { useNav } from '../src/ui/app/navStore'
import { TopBar } from '../src/ui/app/TopBar'

vi.mock('../src/ui/util/SlotLabel', () => ({ SlotLabel: ({ text }: { text: string }) => <span>{text}</span> }))
const initialConfig = useConfig.getState()
const initialDoc = useDoc.getState()
const config: ClientConfig = {
  version: 1, theme: 'grid', fontSize: 16, lineHeight: 1.6, contentWidth: 736,
  authorTag: 'alex', fontPreset: 'grid', monoFont: 'geist', codeTheme: 'none',
  uiLang: 'en', translationLanguage: null, grain: {},
}
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useConfig.setState(initialConfig)
  useDoc.setState(initialDoc)
  vi.unstubAllGlobals()
})

it.each([
  { lang: 'en', headings: ['Base version', 'Your edits', 'File on disk'], result: 'Merge result',
    save: 'Save merge result', baseHint: 'The version loaded or saved before these conflicting changes.' },
  { lang: 'zh-CN', headings: ['基准版本', '你的编辑', '磁盘文件'], result: '合并结果',
    save: '保存合并结果', baseHint: '发生这些冲突更改前加载或保存的版本。' },
] as const)('names the captured conflict versions and editable result in $lang', (labels) => {
  useConfig.setState({ config: { ...config, uiLang: labels.lang } })
  const store = createDocStore()
  store.setState({ conflict: true, conflictDraft: {
    open: true, base: 'loaded text', local: 'my changes', localRevision: 0,
    diskContent: 'external changes', diskVersion: 'v2', diskMtimeMs: 2,
    result: 'my changes', refreshing: false, error: null,
  } })
  act(() => root.render(<ConflictPanel store={store} />))
  expect([...host.querySelectorAll('h3')].map((item) => item.textContent)).toEqual(labels.headings)
  expect(host.querySelector('h3')?.title).toBe(labels.baseHint)
  expect(host.querySelector('textarea')?.labels?.[0]?.querySelector('span')?.textContent).toBe(labels.result)
  expect(host.querySelector('textarea')?.value).toBe('my changes')
  expect([...host.querySelectorAll('button')].some((item) => item.textContent === labels.save)).toBe(true)
})

it.each(['en', 'zh-CN'] as const)('keeps Markdown mode accessible in %s', (uiLang) => {
  useConfig.setState({ config: { ...config, uiLang } })
  const setMode = vi.fn()
  useDoc.setState({ mode: 'reading', setMode })
  act(() => root.render(<TopBar />))
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Markdown"]')!
  expect(button.title).toBe('Markdown')
  act(() => button.click())
  expect(setMode).toHaveBeenCalledWith('source')
})

it.each(['en', 'zh-CN'] as const)('keeps settings in the document toolbar in %s', (uiLang) => {
  useConfig.setState({ config: { ...config, uiLang } })
  const onToggle = vi.fn()
  act(() => root.render(<TopBar settings={{ open: true, onToggle }} />))
  const label = uiLang === 'en' ? 'Settings' : '设置'
  const button = host.querySelector<HTMLButtonElement>(`header [aria-label="${label}"]`)!
  expect(button.getAttribute('aria-pressed')).toBe('true')
  act(() => button.click())
  expect(onToggle).toHaveBeenCalledOnce()
})

it('retains outline navigation to existing-file source offsets', () => {
  const scroller = vi.fn()
  useDoc.setState({ scroller })
  useNav.setState({ outline: [{ depth: 1, text: 'First', offset: 0 }, { depth: 2, text: 'Second', offset: 12 }],
    docEl: null, collapsed: false, mobileOpen: false })
  act(() => root.render(<Tooltip.Provider><Navigator /></Tooltip.Provider>))
  const second = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Second')!
  act(() => second.click())
  expect(scroller).toHaveBeenCalledWith(12, 1)
  expect(host.querySelector('.nav-seg')).toBeNull()
  useNav.setState({ outline: [], docEl: null })
})
