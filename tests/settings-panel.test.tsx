// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientConfig } from '../src/shared/types'
import { useConfig } from '../src/ui/app/configStore'
import { SettingsPanel } from '../src/ui/settings/SettingsPanel'

const config: ClientConfig = {
  version: 1, theme: 'grid', fontSize: 16, lineHeight: 1.6, contentWidth: 736,
  authorTag: 'alex', typeSet: 'grid', monoFont: 'geist', codeTheme: 'none',
  uiLang: 'en', comfortLang: null, browser: '', grain: {},
}

let host: HTMLDivElement
let root: Root
const initialState = useConfig.getState()
const update = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  update.mockClear()
  useConfig.setState({
    config: { ...config },
    browsers: [{ id: 'Safari', name: 'Safari' }],
    themes: [],
    update,
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useConfig.setState(initialState)
  vi.unstubAllGlobals()
})

describe('settings browser preference', () => {
  it.each([['en', 'Open in browser'], ['zh-CN', '在浏览器中打开']] as const)(
    'labels the browser choice in %s and updates the preference', (uiLang, label) => {
      useConfig.setState({ config: { ...config, uiLang } })
      act(() => root.render(<SettingsPanel onClose={() => {}} />))
      const safari = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Safari')!
      expect(safari.closest('.settings-row')?.querySelector('span')?.textContent).toBe(label)
      act(() => safari.click())
      expect(update).toHaveBeenCalledWith({ browser: 'Safari' })
    },
  )
})

it('uses one optional translation-language field and turns translation off explicitly', () => {
  useConfig.setState({ config: { ...config, comfortLang: 'zh-CN' } })
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  expect(host.querySelectorAll('.lang-select')).toHaveLength(1)
  const off = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Original only')!
  act(() => off.click())
  expect(update).toHaveBeenCalledWith({ comfortLang: null })
  expect(host.textContent).not.toContain('Preferred language')
})

it('stores the explicit language code selected from the translation picker', () => {
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  act(() => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
  const option = Array.from(host.querySelectorAll<HTMLElement>('[role="option"]')).find((item) => item.textContent?.includes('Simplified Chinese'))!
  act(() => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(update).toHaveBeenCalledWith({ comfortLang: 'zh-CN' })
})

it.each([
  { uiLang: 'en', name: 'Name', hint: 'This name appears beside your comments.',
    font: 'Font preset', color: 'Code color scheme', width: 'Text width',
    language: 'Translation language', interfaceLanguage: 'Interface language', soft: 'Soft' },
  { uiLang: 'zh-CN', name: '名字', hint: '这个名字会显示在你的评论旁。',
    font: '字体预设', color: '代码配色', width: '正文宽度',
    language: '译文语言', interfaceLanguage: '界面语言', soft: '柔和' },
] as const)('uses canonical settings labels in $uiLang without changing preference keys', (labels) => {
  useConfig.setState({ config: { ...config, uiLang: labels.uiLang } })
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  const input = host.querySelector<HTMLInputElement>('input.settings-input')!
  expect(input.labels?.[0]?.querySelector('span')?.textContent).toBe(labels.name)
  expect(input.title).toBe(labels.hint)
  act(() => {
    input.value = '李 明'
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
  expect(update).toHaveBeenLastCalledWith({ authorTag: '李 明' })
  const button = (name: string) => Array.from(host.querySelectorAll('button'))
    .find((item) => item.textContent === name)!
  const font = button('Schibsted')
  expect(font.closest('.settings-row')?.querySelector('span')?.textContent).toBe(labels.font)
  act(() => font.click())
  expect(update).toHaveBeenLastCalledWith({ typeSet: 'grid' })
  const soft = button(labels.soft)
  expect(soft.closest('.settings-row')?.querySelector('span')?.textContent).toBe(labels.color)
  act(() => soft.click())
  expect(update).toHaveBeenLastCalledWith({ codeTheme: 'soft' })
  expect(host.querySelector(`[aria-label="${labels.width}"]`)).not.toBeNull()
  expect(host.querySelector('.lang-trigger')?.getAttribute('aria-label')).toBe(labels.language)
  expect(host.textContent).toContain(labels.interfaceLanguage)
})
