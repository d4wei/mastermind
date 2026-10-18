// @vitest-environment jsdom
import { openReaderMenu, readerMenuItem } from './helpers/reader-menu'
import { Tooltip } from 'radix-ui'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ClientConfig } from '../ui/settings/types'
import { useConfig } from '../ui/app/configStore'
import { installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { ConflictPanel } from '../ui/app/ConflictPanel'
import { createDocStore, useDoc } from '../ui/documents/store'
import { Navigator } from '../ui/app/Navigator'
import { useNav } from '../ui/app/navStore'
import { TopBar } from '../ui/app/TopBar'

vi.mock('../ui/util/SlotLabel', () => ({ SlotLabel: ({ text }: { text: string }) => <span>{text}</span> }))
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
  { lang: 'en', copy: 'Save As…', incoming: 'Use incoming' },
  { lang: 'zh-CN', copy: '另存为…', incoming: '采用外部版本' },
] as const)('names the recovery actions in $lang', (labels) => {
  installHost(fakeHost({ saveCopy: async () => null }))
  useConfig.setState({ config: { ...config, uiLang: labels.lang } })
  const store = createDocStore()
  store.setState({ conflict: true })
  act(() => root.render(<ConflictPanel store={store} />))
  expect(host.textContent).toContain(labels.copy)
  expect(host.textContent).toContain(labels.incoming)
  expect(host.querySelector('textarea')).toBeNull()
  installHost(null)
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

it.each(['en', 'zh-CN'] as const)('keeps settings in the overflow menu in %s', (uiLang) => {
  useConfig.setState({ config: { ...config, uiLang } })
  const onToggle = vi.fn()
  act(() => root.render(<TopBar settings={{ open: true, onToggle }} />))
  const label = uiLang === 'en' ? 'Settings' : '设置'
  openReaderMenu(host)
  const button = readerMenuItem(label)
  act(() => button.click())
  expect(onToggle).toHaveBeenCalledOnce()
})

it('retains outline navigation to existing-file source offsets', () => {
  const scroller = vi.fn()
  useDoc.setState({ scroller })
  useNav.setState({ outline: [{ depth: 1, text: 'First', offset: 0 }, { depth: 2, text: 'Second', offset: 12 }],
    docEl: null })
  act(() => root.render(<Tooltip.Provider><Navigator /></Tooltip.Provider>))
  act(() => host.querySelector<HTMLButtonElement>('.outline-progress')!.click())
  const second = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Second')!
  act(() => second.click())
  expect(scroller).toHaveBeenCalledWith(12, 1)
  expect(host.querySelector('.nav-seg')).toBeNull()
  useNav.setState({ outline: [], docEl: null })
})
