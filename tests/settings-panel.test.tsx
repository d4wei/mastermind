// @vitest-environment jsdom
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { createReactHost, removeReactHost } from './helpers/dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ClientConfig } from '../ui/settings/types'
import { useConfig } from '../ui/app/configStore'
import { SettingsPanel } from '../ui/settings/SettingsPanel'
import { scanThemes } from '../themes/discovery'
import path from 'node:path'

const bundledThemes = await scanThemes(path.resolve('themes'))

const config: ClientConfig = {
  version: 1, theme: 'grid', fontSize: 16, lineHeight: 1.6, contentWidth: 736,
  authorTag: 'alex', fontPreset: 'grid', monoFont: 'geist', codeTheme: 'none',
  uiLang: 'en',
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

it.each(['en', 'zh-CN'] as const)('offers theme choices without texture controls in %s', (uiLang) => {
  useConfig.setState({ themes: bundledThemes })
  for (const theme of bundledThemes) {
    const savedConfig = { ...config, uiLang, theme: theme.id,
      grain: { [theme.id]: { intensity: 'high', texture: 'coarse' } } }
    act(() => {
      useConfig.setState({ config: savedConfig })
      root.render(<SettingsPanel onClose={() => {}} />)
    })
    const appearance = host.querySelectorAll('section')[1]!
    expect(appearance.querySelectorAll('.settings-row')).toHaveLength(1)
    expect(appearance.querySelectorAll('button')).toHaveLength(bundledThemes.length)
    expect(appearance.querySelector('[aria-pressed="true"]')?.textContent).toBe(theme.name)
    expect(host.querySelector('feTurbulence')).toBeNull()
  }
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
  expect(host.textContent).not.toContain(labels.language)
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
