// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { TranslatedSelection } from '../src/ui/translate/TranslatedSelection'
import { useTranslation } from '../src/ui/translate/translationStore'
import { useConfig } from '../src/ui/app/configStore'
import { useDoc } from '../src/ui/app/store'
import { prepareTranslation, parseTranslatedComment, type PreparedTranslation } from '../src/shared/translation'
import { analyzeMarkdown } from '../src/shared/markdown/analyze'
import { CommentBody } from '../src/ui/review/CommentBody'
let host: HTMLDivElement
let root: Root
let artifact: PreparedTranslation
const initial = useDoc.getState()
const initialConfig = useConfig.getState()
const source = 'First paragraph.\n\nSecond paragraph.'
const quote = '精确片段 “引用”\n第二行'
function Harness() {
  const ref = useRef<HTMLElement>(null)
  return <><article ref={ref}><div data-trans-block-id={artifact.blocks[0]!.id} id="first">{quote}</div>
    <div data-trans-block-id={artifact.blocks[1]!.id} id="second">Second translation</div></article>
    <TranslatedSelection containerRef={ref} sessionId="A" artifact={artifact} authorTag="Da Wei" /></>
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', webcrypto)
  const projection = await prepareTranslation(source)
  artifact = { version: 1, sourceHash: projection.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: projection.blocks.filter((block) => block.translatable).map((block, index) => ({ id: block.id, text: index ? 'Second translation' : quote })) }
  useConfig.setState({ config: { ...initialConfig.config!, translationLanguage: 'zh-CN' } })
  useDoc.setState({ ...initial, sessionId: 'A', source, savedSource: source, queueAutosave: vi.fn() })
  useTranslation.setState({ sessionId: 'A', source, targetLang: 'zh-CN', active: true, artifact, error: null })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<Harness />))
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); useDoc.setState(initial); useConfig.setState(initialConfig); useTranslation.getState().reset()
  window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals()
})
function select(crossBlock = false) {
  const range = document.createRange()
  const first = host.querySelector('#first')!.firstChild!
  range.setStart(first, 0)
  range.setEnd(crossBlock ? host.querySelector('#second')!.firstChild! : first,
    crossBlock ? 6 : quote.length)
  range.getBoundingClientRect = () => ({ top: 100, left: 100, width: 40 } as DOMRect)
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
}
function compose() {
  select()
  act(() => host.querySelector<HTMLButtonElement>('.sel-toolbar button')!.click())
  const input = host.querySelector('textarea')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'My authored note {++literal++}\nline two')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return host.querySelector<HTMLButtonElement>('.primary')!
}
async function submitComment(button: HTMLButtonElement) {
  const changed = new Promise<void>((resolve) => {
    const before = useDoc.getState().source
    const unsubscribe = useDoc.subscribe((state) => {
      if (state.source !== before) { unsubscribe(); resolve() }
    })
  })
  await act(async () => { button.click(); button.click(); await changed })
}
it('rejects a selection spanning translated blocks', () => {
  select(true)
  expect(host.querySelector('.sel-toolbar')).toBeNull()
})
it('comments on one translated block with exact quote/language and one undoable source edit', async () => {
  const submit = compose()
  expect(submit.disabled).toBe(false)
  await submitComment(submit)
  const updated = useDoc.getState().source
  const comments = analyzeMarkdown(updated).items.flatMap((item) => item.type === 'thread' ? item.comments : [])
  expect(comments).toHaveLength(1)
  expect(comments[0]!.author).toBe('Da Wei')
  expect(parseTranslatedComment(comments[0]!.body)).toEqual({ language: 'zh-CN', quote,
    comment: 'My authored note {++literal++}\nline two' })
  expect(updated.startsWith('First paragraph.{>>')).toBe(true)
  expect((await prepareTranslation(updated)).sourceHash).toBe(artifact.sourceHash)
  act(() => useDoc.getState().undo())
  expect(useDoc.getState().source).toBe(source)
})
it.each(['navigation', 'narrative', 'target'])('rejects a composer captured before %s changes', async (change) => {
  const submit = compose()
  act(() => {
    if (change === 'navigation') useDoc.setState({ sessionId: 'B' })
    if (change === 'narrative') useDoc.setState({ source: 'Changed prose.' })
    if (change === 'target') useConfig.setState({ config: { ...useConfig.getState().config!, translationLanguage: 'ja' } })
  })
  const before = useDoc.getState().source
  await act(async () => { submit.click(); await new Promise((resolve) => setTimeout(resolve, 30)) })
  expect(useDoc.getState().source).toBe(before)
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
})
it('decodes translated comments into safe literal quote and authored-language display', async () => {
  const submit = compose()
  await submitComment(submit)
  const comment = analyzeMarkdown(useDoc.getState().source).items.flatMap((item) => item.type === 'thread' ? item.comments : [])[0]!
  act(() => root.render(<CommentBody body={comment.body} />))
  expect(host.querySelector('blockquote')!.textContent).toBe(`zh-CN\n${quote}`)
  expect(host.textContent).toContain('My authored note {++literal++} line two')
  expect(host.textContent).not.toContain('translated-selection v1')
})

it('preserves the translated-comment draft across IME cancellation without submitting', () => {
  compose()
  const textarea = host.querySelector('textarea')!
  const draft = textarea.value
  act(() => {
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true,
      isComposing: true, bubbles: true }))
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true,
      keyCode: 229, bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true }))
  })
  expect(host.querySelector('textarea')).toBe(textarea)
  expect(textarea.value).toBe(draft)
  expect(useDoc.getState().source).toBe(source)
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('textarea')).toBeNull()
})
