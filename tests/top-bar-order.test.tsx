// @vitest-environment jsdom
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TopBar } from '../ui/app/TopBar'
import { ToolbarTarget } from '../ui/app/ToolbarTarget'
import { useDoc } from '../ui/documents/store'
import { useTranslation } from '../ui/translate/translationStore'
import { createReactHost, removeReactHost } from './helpers/dom'

let host: HTMLDivElement
let root: Root
const doc = useDoc.getState()
const translation = useTranslation.getState()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  ;({ host, root } = createReactHost())
  useDoc.setState({ sessionId: 'A' })
})
afterEach(() => {
  removeReactHost(root, host)
  useDoc.setState(doc); useTranslation.setState(translation); vi.unstubAllGlobals()
})

function controls(mode: 'reading' | 'source', options: { translations: boolean; comments: boolean; portal: boolean }) {
  useDoc.setState({ mode })
  useTranslation.setState({ ...translation, sessionId: 'A', targetLang: null, available: options.translations
    ? [{ version: 1, sourceHash: '', sourceLang: 'en', targetLang: 'fr', blocks: [] }] : [] })
  const target = options.portal ? document.createElement('div') : null
  if (target) document.body.append(target)
  const bar = <TopBar settings={{ open: false, onToggle() {} }} resolved={{ count: 0, open: false, onToggle() {} }}
    railOpen onToggleRail={() => {}} commentsAvailable={options.comments} />
  act(() => root.render(<ToolbarTarget.Provider value={target}>{bar}</ToolbarTarget.Provider>))
  const header = (target ?? host).querySelector('.topbar')!
  const labels = Array.from(header.children, (child) => child.getAttribute('aria-label')!.replace(/:.*/, ''))
  target?.remove()
  return labels
}

it.each([
  ['reading', true, true, ['Reading language', 'Find', 'Hide comments', 'Markdown', 'More']],
  ['reading', false, true, ['Find', 'Hide comments', 'Markdown', 'More']],
  ['reading', true, false, ['Reading language', 'Find', 'Markdown', 'More']],
  ['source', true, true, ['Find', 'Read', 'More']],
] as const)('keeps the mode button beside More in %s mode (translations %s, comments %s)', (mode, translations, comments, expected) => {
  for (const portal of [false, true]) expect(controls(mode, { translations, comments, portal })).toEqual(expected)
})

it('keeps the class and label other checks select the mode button by', () => {
  controls('reading', { translations: false, comments: true, portal: false })
  const mode = host.querySelectorAll('.topbar > button')
  expect(host.querySelector('.topbar-icon-btn[aria-label="Markdown"]')).toBe(mode[mode.length - 2])
})
