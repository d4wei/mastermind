// @vitest-environment jsdom
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { createReactHost, removeReactHost, inputValue } from './helpers/dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  useConfig.setState(initialState)
  vi.unstubAllGlobals()
})

it('omits browser selection while retaining appearance settings', () => {
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  expect(host.textContent).not.toContain('Open in browser')
  expect(host.textContent).toContain('Appearance')
})

it.each([
  { language: 'en', sections: ['General', 'Appearance', 'Reading', 'Code'],
    reading: ['Font preset', 'Font size', 'Line height', 'Text width'] },
  { language: 'zh-CN', sections: ['通用', '外观', '阅读', '代码'],
    reading: ['字体预设', '字号', '行高', '正文宽度'] },
] as const)('groups settings by scope in $language', ({ language, sections, reading }) => {
  useConfig.setState({ config: { ...config, uiLang: language } })
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  expect(Array.from(host.querySelectorAll('h4'), (heading) => heading.textContent)).toEqual(sections)
  const readingRows = host.querySelectorAll('section')[2]!.querySelectorAll('.settings-row > span')
  expect(Array.from(readingRows, (row) => row.firstChild?.textContent?.trim())).toEqual(reading)
})

it('searches languages and custom codes, exposes keyboard focus, and cancels without saving', () => {
  const close = vi.fn()
  act(() => root.render(<SettingsPanel onClose={close} />))
  const trigger = host.querySelector<HTMLButtonElement>('.lang-trigger')!
  act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  let search = host.querySelector<HTMLInputElement>('.lang-search')!
  const key = (key: string) => act(() => search.dispatchEvent(new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true,
  })))
  act(() => inputValue(search, '简体'))
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1)
  expect(document.getElementById(search.getAttribute('aria-activedescendant')!)?.textContent).toContain('简体中文')
  expect(update).not.toHaveBeenCalled()
  key('Enter')
  expect(update).toHaveBeenLastCalledWith({ translationLanguage: 'zh-CN' })
  expect(document.activeElement).toBe(trigger)

  act(() => trigger.click())
  search = host.querySelector<HTMLInputElement>('.lang-search')!
  act(() => inputValue(search, 'yue-Hant'))
  key('Enter')
  expect(update).toHaveBeenLastCalledWith({ translationLanguage: 'yue-Hant' })
  update.mockClear()
  act(() => trigger.click())
  search = host.querySelector<HTMLInputElement>('.lang-search')!
  act(() => inputValue(search, 'French'))
  key('Escape')
  expect(update).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(trigger)
  expect(host.querySelector('.lang-search')).toBeNull()
})

it('does not commit an empty search result and closes on focus leaving the picker', () => {
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  act(() => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
  const search = host.querySelector<HTMLInputElement>('.lang-search')!
  act(() => inputValue(search, '???'))
  act(() => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
  expect(update).not.toHaveBeenCalled()
  expect(search.hasAttribute('aria-activedescendant')).toBe(false)
  act(() => host.querySelector<HTMLInputElement>('input.settings-input')!.focus())
  expect(host.querySelector('.lang-search')).toBeNull()
})

it('uses one optional translation-language field and turns translation off explicitly', () => {
  useConfig.setState({ config: { ...config, translationLanguage: 'zh-CN' } })
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  expect(host.querySelectorAll('.lang-select')).toHaveLength(1)
  expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent === 'Original only')).toBe(false)
  act(() => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
  const off = Array.from(host.querySelectorAll('[role="option"]')).find((option) => option.textContent === 'Original only')!
  act(() => off.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
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
  { uiLang: 'en', name: 'Your name', hint: 'This name appears beside your comments.',
    font: 'Font preset', color: 'Code color scheme', width: 'Text width',
    language: 'Translation language', interfaceLanguage: 'Interface language', soft: 'Soft' },
  { uiLang: 'zh-CN', name: '你的名字', hint: '这个名字会显示在你的评论旁。',
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
