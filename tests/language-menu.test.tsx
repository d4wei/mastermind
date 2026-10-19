// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { LanguageMenu } from '../ui/translate/LanguageMenu'
import { languageName } from '../ui/translate/languages'
import { useTranslation } from '../ui/translate/translationStore'
import { useDoc } from '../ui/documents/store'
import { useConfig } from '../ui/app/configStore'
import { DEFAULT_CONFIG } from '../ui/settings/defaults'
import { DraftScope, useDraftGuard, releaseDrafts, useDraftFocus } from '../ui/review/drafts'
import { useClosePrompt } from '../ui/desktop/CloseDialog'
let root: Root
let host: HTMLDivElement
const initial = useTranslation.getState()
const doc = useDoc.getState()
const config = useConfig.getState()
let select = vi.fn()
const discard = vi.fn()
function Draft() { useDraftGuard('translated', 'Comment', true, () => {}, discard); return null }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  select = vi.fn(); discard.mockClear()
  useConfig.setState({ config: DEFAULT_CONFIG })
  useDoc.setState({ sessionId: 'A' })
  useTranslation.setState({ ...initial, sessionId: 'A', targetLang: null,
    available: ['fr', 'zh-CN'].map((targetLang) => ({ version: 1, sourceHash: '', sourceLang: 'en', targetLang, blocks: [] })), select })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); releaseDrafts('A')
  useTranslation.setState(initial); useDoc.setState(doc); useConfig.setState(config)
  useClosePrompt.setState({ prompt: null }); useDraftFocus.setState({ target: null }); vi.unstubAllGlobals()
})
async function mount(draft = false) { await act(async () => root.render(<DraftScope id="A"><LanguageMenu />{draft && <Draft />}</DraftScope>)) }
async function open() { await act(async () => host.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))) }
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
it('shows original and native language names with one selection indicator', async () => {
  await mount(); await open()
  expect(items().map((item) => item.textContent)).toEqual(['Original', 'français', '简体中文'])
  expect(items().filter((item) => item.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  expect(document.activeElement).toBe(items()[0])
  await act(async () => items()[1]!.click())
  expect(select).toHaveBeenCalledWith('fr')
  expect(items()).toEqual([])
})
it.each(['mastermind-find', 'mastermind-files-open'])('dismisses when %s opens', async (event) => {
  await mount(); await open()
  await act(async () => window.dispatchEvent(new Event(event)))
  expect(items()).toEqual([])
})
it('omits the picker without valid translations and localizes surrounding labels', async () => {
  useTranslation.setState({ available: [] }); await mount()
  expect(host.querySelector('button')).toBeNull()
  useConfig.setState({ config: { ...DEFAULT_CONFIG, uiLang: 'zh-CN' } })
  useTranslation.setState({ available: [{ version: 1, sourceHash: '', sourceLang: 'en', targetLang: 'fr', blocks: [] }] })
  await mount()
  expect(host.querySelector('button')!.getAttribute('aria-label')).toBe('阅读语言: 原文')
})
it.each(['cancel', 'discard'] as const)('handles an unfinished draft before switching: %s', async (choice) => {
  await mount(true); await open()
  await act(async () => items()[1]!.click())
  expect(items()).toEqual([])
  expect(useClosePrompt.getState().prompt?.kind).toBe('draft')
  expect(select).not.toHaveBeenCalled()
  await act(async () => useClosePrompt.getState().choose(choice))
  if (choice === 'discard') { expect(discard).toHaveBeenCalledOnce(); expect(select).toHaveBeenCalledWith('fr') }
  else { expect(discard).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled() }
})
it('distinguishes regional names and safely labels unfamiliar codes', () => {
  expect(languageName('pt-BR')).not.toBe(languageName('pt-PT'))
  expect(languageName('zh-TW')).not.toBe(languageName('zh-HK'))
  expect(languageName('not_a_real_language')).toBeTruthy()
})
