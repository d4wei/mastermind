// @vitest-environment jsdom
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Analysis } from '../document/markdown/analyze'
import { createReactHost, removeReactHost } from './helpers/dom'

const analyses = vi.hoisted(() => [] as { source: string; result: Analysis }[])
vi.mock('../document/markdown/analyze', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../document/markdown/analyze')>()
  return { ...actual, analyzeMarkdown: (source: string) => {
    const result = actual.analyzeMarkdown(source)
    analyses.push({ source, result })
    return result
  } }
})

let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', (await import('node:crypto')).webcrypto)
  analyses.length = 0
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  vi.unstubAllGlobals()
})

it('renders translated blocks without stripping positions from shared trees or re-analyzing on rerender', async () => {
  const { prepareTranslation } = await import('../document/translation')
  const { TranslatedView } = await import('../ui/translate/TranslatedView')
  const source = '# Heading\n\nBody.\n\n{>>@Alex: note<<}\n'
  const prepared = await prepareTranslation(source)
  const artifact = { version: 1 as const, sourceHash: prepared.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: prepared.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id,
      text: block.kind === 'heading' ? '# 标题' : '正文。' })) }
  const view = () => <TranslatedView sessionId="translated" source={source} artifact={artifact} containerRef={null} />
  await act(async () => root.render(view()))
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(host.querySelector('.trans-view')).not.toBeNull()
  })
  // A mark-free block's reading tree is its plain tree.
  const block = analyses.find((entry) => entry.source === '正文。')!.result
  expect(block.tree).toBe(block.plain)
  expect(block.plain.children[0]!.position).toBeDefined()
  const count = analyses.length
  act(() => root.render(view()))
  expect(analyses.length).toBe(count)
})
