import { fakeHost } from './helpers/host'
import { installHost, HostError, type HostFailure, type ReviewerHost } from '../ui/app/host'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTranslationStore, type TranslationSnapshot } from '../ui/translate/translationStore'
import { prepareTranslation, type PreparedTranslation } from '../document/translation'
let snapshot: TranslationSnapshot
beforeEach(() => { snapshot = { sessionId: 'A', source: 'Hello world.', targetLang: 'zh-CN' } })
afterEach(() => { installHost(null); vi.unstubAllGlobals() })
async function artifact(source = snapshot.source, targetLang = 'zh-CN'): Promise<PreparedTranslation> {
  const prepared = await prepareTranslation(source)
  return { version: 1, sourceHash: prepared.sourceHash, sourceLang: 'en', targetLang,
    blocks: prepared.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id, text: '你好世界。' })) }
}
function installTranslation(translation: ReviewerHost['translation']) { installHost(fakeHost({ translation })) }
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>((r) => { resolve = r }); return { promise, resolve } }

it('loads one complete prepared artifact through the host without generating translations', async () => {
  const prepared = await artifact()
  const readTranslation = vi.fn().mockResolvedValue(prepared)
  installTranslation(readTranslation)
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  expect(readTranslation).toHaveBeenCalledTimes(1)
  expect(readTranslation).toHaveBeenCalledWith('A', 'zh-CN')
  expect(store.getState().active).toBe(true)
})
it.each<HostFailure>(['missing', 'conflict', 'failure'])('falls back to original after %s with no retained artifact', async (kind) => {
  installTranslation(vi.fn().mockRejectedValue(new HostError(kind, 'unavailable')))
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  expect(store.getState().active).toBe(false)
  expect(store.getState().artifact).toBeNull()
  expect(store.getState().loading).toBe(false)
  expect(store.getState().error).toBe(kind === 'missing' ? 'missing' : kind === 'conflict' ? 'stale' : 'unavailable')
})
it('retains prepared narrative across comments and highlights but invalidates prose and suggestions', async () => {
  const prepared = await artifact()
  const readTranslation = vi.fn().mockResolvedValue(prepared); installTranslation(readTranslation)
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  snapshot.source = '{==Hello==} world.{>>@Da Wei: 中文评论<<}'
  await store.getState().synchronize()
  expect(store.getState().active).toBe(true)
  expect(readTranslation).toHaveBeenCalledTimes(1)
  snapshot.source = 'Hello {++new++} world.'
  await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
  expect(store.getState().artifact).toBeNull()
  expect(store.getState().error).toBe('stale')
})
it.each(['navigation', 'language', 'edit'])('rejects a slow load after %s', async (change) => {
  const prepared = await artifact()
  const pending = deferred(); installTranslation(vi.fn().mockReturnValue(pending.promise))
  const store = createTranslationStore(() => snapshot)
  const load = store.getState().toggle()
  snapshot = change === 'navigation' ? { ...snapshot, sessionId: 'B' }
    : change === 'language' ? { ...snapshot, targetLang: 'ja' } : { ...snapshot, source: 'Changed prose.' }
  await store.getState().synchronize()
  pending.resolve(prepared); await load
  expect(store.getState().active).toBe(false)
  expect(store.getState().artifact).toBeNull()
  expect(store.getState().loading).toBe(false)
})
it('validates against comments added while the artifact request is in flight', async () => {
  const prepared = await artifact()
  const pending = deferred(); installTranslation(vi.fn().mockReturnValue(pending.promise))
  const store = createTranslationStore(() => snapshot)
  const load = store.getState().toggle()
  snapshot.source += '{>>@Da Wei: note<<}'
  await store.getState().synchronize()
  pending.resolve(prepared); await load
  expect(store.getState().active).toBe(true)
  expect(store.getState().source).toBe(snapshot.source)
})
it.each(['target', 'blocks'])('rejects an artifact whose %s does not match', async (mismatch) => {
  const prepared = await artifact()
  installTranslation(vi.fn().mockResolvedValue(mismatch === 'target' ? { ...prepared, targetLang: 'ja' } : { ...prepared, blocks: [] }))
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  expect(store.getState().active).toBe(false)
  expect(store.getState().error).toBe('stale')
})
it('does not issue requests when translation is disabled', async () => {
  snapshot.targetLang = null
  const readTranslation = vi.fn(); installTranslation(readTranslation)
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  expect(readTranslation).not.toHaveBeenCalled()
})

it('keeps the latest document artifact when requests complete in reverse order', async () => {
  const prepared = await artifact()
  const first = deferred(); const second = deferred()
  installTranslation(vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
  const store = createTranslationStore(() => snapshot)
  const a = store.getState().toggle()
  snapshot = { ...snapshot, sessionId: 'B' }
  await store.getState().synchronize()
  const b = store.getState().toggle()
  second.resolve(prepared); await b
  expect(store.getState().sessionId).toBe('B')
  expect(store.getState().active).toBe(true)
  first.resolve({ ...prepared, blocks: [] }); await a
  expect(store.getState().sessionId).toBe('B')
  expect(store.getState().active).toBe(true)
  expect(store.getState().error).toBeNull()
})

it('stays original after toggling off and then changing annotations or narrative', async () => {
  installTranslation(vi.fn().mockResolvedValue(await artifact()))
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  await store.getState().toggle()
  snapshot.source += '{>>@Da Wei: note<<}'
  await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
  expect(store.getState().error).toBeNull()
  snapshot.source = 'New prose.'
  await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
  expect(store.getState().error).toBeNull()
})
