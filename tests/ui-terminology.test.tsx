// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ClientConfig } from '../src/shared/types'
import { useConfig } from '../src/ui/app/configStore'
import { ConflictPanel } from '../src/ui/app/ConflictPanel'
import { createDocStore, useDoc } from '../src/ui/app/store'
import { FilesList } from '../src/ui/app/Tree'
import { TopBar } from '../src/ui/app/TopBar'
import { useWorkspace } from '../src/ui/app/workspaceStore'

vi.mock('../src/ui/util/SlotLabel', () => ({ SlotLabel: ({ text }: { text: string }) => <span>{text}</span> }))
const initialConfig = useConfig.getState()
const initialDoc = useDoc.getState()
const initialWorkspace = useWorkspace.getState()
const config: ClientConfig = {
  version: 1, theme: 'grid', fontSize: 16, lineHeight: 1.6, contentWidth: 736,
  authorTag: 'alex', fontPreset: 'grid', monoFont: 'geist', codeTheme: 'none',
  uiLang: 'en', translationLanguage: null, browser: '', grain: {},
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
  useWorkspace.setState(initialWorkspace)
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

it.each([
  ['en', { comments: 3, edits: 2, highlights: 1 }, '3 comments, 2 suggested edits, 1 highlight'],
  ['en', { comments: 1, edits: 1, highlights: 2 }, '1 comment, 1 suggested edit, 2 highlights'],
  ['en', { comments: 0, edits: 1, highlights: 0 }, '1 suggested edit'],
  ['zh-CN', { comments: 3, edits: 2, highlights: 1 }, '3 条评论、2 条修改建议、1 处高亮'],
] as const)('spells out review counts in %s (%j)', (uiLang, counts, expected) => {
  useConfig.setState({ config: { ...config, uiLang } })
  useWorkspace.setState({ children: { '': [
    { rel: 'plan.md', name: 'plan.md', isDir: false, isMarkdown: true },
  ] }, recent: [], sessions: [], badges: { 'plan.md': counts } })
  act(() => root.render(<FilesList openSessionId={null} />))
  const badge = host.querySelector<HTMLElement>('.ws-count')!
  expect(badge.title).toBe(expected)
  expect(badge.textContent).toBe(String(counts.comments + counts.edits + counts.highlights))
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
