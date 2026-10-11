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
  it.each([['en', 'Browser'], ['zh-CN', '打开浏览器']] as const)(
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

it('uses one optional comfort-language field and turns translation off explicitly', () => {
  useConfig.setState({ config: { ...config, comfortLang: 'zh-CN' } })
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  expect(host.querySelectorAll('.lang-select')).toHaveLength(1)
  const off = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Off')!
  act(() => off.click())
  expect(update).toHaveBeenCalledWith({ comfortLang: null })
  expect(host.textContent).not.toContain('Preferred language')
})

it('stores the explicit language code selected from the comfort picker', () => {
  act(() => root.render(<SettingsPanel onClose={() => {}} />))
  act(() => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
  const option = Array.from(host.querySelectorAll<HTMLElement>('[role="option"]')).find((item) => item.textContent?.includes('Simplified Chinese'))!
  act(() => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(update).toHaveBeenCalledWith({ comfortLang: 'zh-CN' })
})
