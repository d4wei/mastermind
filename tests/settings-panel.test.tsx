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
  uiLang: 'en', langPair: { a: 'English', b: 'Simplified Chinese' }, browser: '', grain: {},
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
