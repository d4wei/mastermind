// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { SessionView } from '../ui/app/SessionView'
import { useDoc } from '../ui/app/store'
import { useConfig } from '../ui/app/configStore'
import { useTranslation } from '../ui/translate/translationStore'
import { prepareTranslation, type PreparedTranslation } from '../document/translation'
vi.mock('../ui/app/ConflictPanel', () => ({ ConflictPanel: () => null }))
vi.mock('../ui/app/api', async (original) => ({ ...await original<object>(), openEvents: () => ({ addEventListener() {}, close() {} }) }))
vi.mock('../ui/util/SlotLabel', () => ({ SlotLabel: ({ text }: { text: string }) => <span>{text}</span> }))
vi.mock('../ui/translate/TranslatedView', () => ({ TranslatedView: ({ containerRef, artifact }: {
  containerRef: React.RefObject<HTMLElement | null>; artifact: PreparedTranslation
}) => <article ref={containerRef}><div data-trans-block-id={artifact.blocks[0]!.id}>{artifact.blocks[0]!.text}</div></article> }))
let host: HTMLDivElement
let root: Root
const initial = useDoc.getState()
const config = useConfig.getState()
const source = 'Hello.'
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  useDoc.setState({ ...initial, sessionId: 'A', status: 'ready', source, savedSource: source, load: vi.fn().mockResolvedValue(undefined) })
  useConfig.setState({ config: { ...config.config!, translationLanguage: 'zh-CN' } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<SessionView sessionId="A" />))
  const prepared = await prepareTranslation(source)
  const artifact: PreparedTranslation = { version: 1, sourceHash: prepared.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: prepared.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id, text: '你好。' })) }
  await act(async () => useTranslation.setState({ sessionId: 'A', source, targetLang: 'zh-CN', active: true, artifact }))
  const text = host.querySelector('[data-trans-block-id]')!.firstChild!
  const range = document.createRange(); range.selectNodeContents(text)
  range.getBoundingClientRect = () => ({ top: 100, left: 100, width: 50 } as DOMRect)
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
  act(() => host.querySelector<HTMLButtonElement>('.sel-toolbar button')!.click())
  const textarea = host.querySelector<HTMLTextAreaElement>('.sel-composer textarea')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Keep my draft')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); useDoc.setState(initial); useConfig.setState(config); useTranslation.getState().reset()
  window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals()
})
it.each(['comment', 'narrative'])('retains the composer draft through a %s update', async (kind) => {
  const changed = kind === 'comment' ? 'Hello.{>>@claude: another comment<<}' : 'Changed prose.'
  await act(async () => { useDoc.setState({ source: changed }); await useTranslation.getState().synchronize() })
  expect(host.querySelector<HTMLTextAreaElement>('.sel-composer textarea')!.value).toBe('Keep my draft')
  expect(useTranslation.getState().active).toBe(kind === 'comment')
  if (kind === 'narrative') expect(host.querySelector('.sel-composer [role="alert"]')).not.toBeNull()
})
