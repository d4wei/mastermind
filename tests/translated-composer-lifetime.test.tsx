import { releaseDrafts } from '../ui/review/drafts'
// @vitest-environment jsdom
import { installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { SessionView } from '../ui/app/SessionView'
import { useDoc } from '../ui/documents/store'
import { useConfig } from '../ui/app/configStore'
import { useTranslation } from '../ui/translate/translationStore'
import { prepareTranslation, type PreparedTranslation } from '../document/translation'
vi.mock('../ui/app/ConflictPanel', () => ({ ConflictPanel: () => null }))
vi.mock('../ui/translate/TranslatedView', () => ({ TranslatedView: ({ containerRef, artifact }: {
  containerRef: React.RefObject<HTMLElement | null>; artifact: PreparedTranslation
}) => <article ref={containerRef}><div data-trans-block-id={artifact.blocks[0]!.id}>{artifact.blocks[0]!.text}</div></article> }))
let host: HTMLDivElement
let root: Root
const initial = useDoc.getState()
const config = useConfig.getState()
const source = 'Hello.'
beforeEach(async () => {
  installHost(fakeHost())
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  useDoc.setState({ ...initial, sessionId: 'A', status: 'ready', source, savedSource: source, load: vi.fn().mockResolvedValue(undefined) })
  useConfig.setState({ config: { ...config.config! } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<SessionView sessionId="A" />))
  const prepared = await prepareTranslation(source)
  const artifact: PreparedTranslation = { version: 1, sourceHash: prepared.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: prepared.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id, text: '你好。' })) }
  installHost(fakeHost({ translations: async () => [artifact] }))
  await act(async () => useTranslation.getState().select('zh-CN'))
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
  act(() => root.unmount()); releaseDrafts('A'); host.remove(); useDoc.setState(initial); useConfig.setState(config); useTranslation.getState().release('A')
  window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals(); installHost(null)
})
it.each(['comment', 'narrative'])('retains the composer draft through a %s update', async (kind) => {
  const changed = kind === 'comment' ? 'Hello.{>>@claude: another comment<<}' : 'Changed prose.'
  await act(async () => { useDoc.setState({ source: changed }); await useTranslation.getState().synchronize() })
  expect(host.querySelector<HTMLTextAreaElement>('.sel-composer textarea')!.value).toBe('Keep my draft')
  await act(async () => {
    await vi.waitFor(() => expect(useTranslation.getState().source).toBe(changed))
  })
  expect(useTranslation.getState().active).toBe(kind === 'comment')
  if (kind === 'narrative') expect(host.querySelector('.sel-composer [role="alert"]')).not.toBeNull()
})

it.each(['same source', 'new source'])('retains the captured passage and draft when a newer translation arrives for %s', async (revision) => {
  const previous = useTranslation.getState().artifact!
  const sourceHash = revision === 'new source' ? (await prepareTranslation('Changed prose.')).sourceHash : previous.sourceHash
  const newer = { ...previous, sourceHash, blocks: previous.blocks.map((block) => ({ ...block, text: '新版译文。' })) }
  await act(async () => useTranslation.setState({ artifact: newer }))
  expect(host.querySelector<HTMLTextAreaElement>('.sel-composer textarea')!.value).toBe('Keep my draft')
  expect(host.querySelector('.sel-composer [role="alert"]')).not.toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('.sel-composer .btn-primary')!.click())
  expect(useDoc.getState().source).toBe(source)
  expect(host.querySelector<HTMLTextAreaElement>('.sel-composer textarea')!.value).toBe('Keep my draft')
})

it('places a remounted composer beside its block rather than at the captured viewport position', () => {
  const composer = () => host.querySelector<HTMLElement>('.sel-toolbar')!
  expect([composer().style.top, composer().style.left]).toEqual(['8px', '100px'])
  act(() => useDoc.getState().setMode('source'))
  expect(host.querySelector('.sel-toolbar')).toBeNull()
  const rect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.dataset.transBlockId ? { top: 400, left: 40 } as DOMRect : rect.call(this)
  }
  try {
    act(() => useDoc.getState().setMode('reading'))
    expect(host.querySelector<HTMLTextAreaElement>('.sel-composer textarea')!.value).toBe('Keep my draft')
    expect([composer().style.top, composer().style.left]).toEqual(['250px', '40px'])
  } finally { HTMLElement.prototype.getBoundingClientRect = rect }
})
