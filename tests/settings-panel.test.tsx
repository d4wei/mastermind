// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientConfig } from '../ui/settings/types'
import { useConfig } from '../ui/app/configStore'
import { SettingsPanel } from '../ui/settings/SettingsPanel'

const config: ClientConfig = {
  version: 1, theme: 'grid', fontSize: 16, lineHeight: 1.6, contentWidth: 736,
  authorTag: 'alex', fontPreset: 'grid', monoFont: 'geist', codeTheme: 'none',
  uiLang: 'en', translationLanguage: null, grain: {},
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

it('omits browser selection while retaining appearance settings', () => {
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  expect(host.textContent).not.toContain('Open in browser')
  expect(host.textContent).toContain('Appearance')
})

it('uses one optional translation-language field and turns translation off explicitly', () => {
  useConfig.setState({ config: { ...config, translationLanguage: 'zh-CN' } })
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  expect(host.querySelectorAll('.lang-select')).toHaveLength(1)
  const off = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Original only')!
  act(() => off.click())
  expect(update).toHaveBeenCalledWith({ translationLanguage: null })
  expect(host.textContent).not.toContain('Preferred language')
})

it('stores the explicit language code selected from the translation picker', () => {
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  act(() => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
  const option = Array.from(host.querySelectorAll<HTMLElement>('[role="option"]')).find((item) => item.textContent?.includes('Simplified Chinese'))!
  act(() => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(update).toHaveBeenCalledWith({ translationLanguage: 'zh-CN' })
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
  expect(update).toHaveBeenLastCalledWith({ fontPreset: 'grid' })
  const soft = button(labels.soft)
  expect(soft.closest('.settings-row')?.querySelector('span')?.textContent).toBe(labels.color)
  act(() => soft.click())
  expect(update).toHaveBeenLastCalledWith({ codeTheme: 'soft' })
  expect(host.querySelector(`[aria-label="${labels.width}"]`)).not.toBeNull()
  expect(host.querySelector('.lang-trigger')?.getAttribute('aria-label')).toBe(labels.language)
  expect(host.textContent).toContain(labels.interfaceLanguage)
})

it.each(['Alex: Admin', 'Alex{Chen', 'Alex@Chen', 'a'.repeat(65)])(
  'does not persist an unusable comment Name %j', (name) => {
    act(() => root.render(<SettingsPanel onClose={() => {}} />))
    const input = host.querySelector<HTMLInputElement>('input.settings-input')!
    act(() => {
      input.value = name
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(update).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('64')
    act(() => {
      input.value = ' @ 李 明 '
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(update).toHaveBeenCalledWith({ authorTag: '李 明' })
    expect(input.getAttribute('aria-invalid')).toBe('false')
  },
)

it.each(['active', 'native', 'legacy'] as const)(
  'keeps language selection uncommitted during IME Enter: %s', (kind) => {
    act(() => root.render(<SettingsPanel onClose={() => {}} />))
    act(() => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
    const input = host.querySelector<HTMLInputElement>('.lang-search')!
    act(() => {
      if (kind !== 'native') input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      if (kind === 'legacy') input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true,
        isComposing: kind === 'native', keyCode: kind === 'legacy' ? 229 : 13 })
      input.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })
    expect(update).not.toHaveBeenCalled()
    expect(host.querySelector('.lang-search')).toBe(input)
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(update).toHaveBeenCalledOnce()
    expect(host.querySelector('.lang-search')).toBeNull()
  },
)

it('clears language-search composition when the input detaches without blur', () => {
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  act(() => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
  const input = host.querySelector<HTMLInputElement>('.lang-search')!
  act(() => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(host.querySelector('.lang-search')).toBeNull()
  act(() => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
  act(() => host.querySelector('.lang-search')!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
  expect(update).toHaveBeenCalledOnce()
})
