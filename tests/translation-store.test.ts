import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTranslationStore, type TranslationSnapshot } from '../src/ui/translate/translationStore'
import { prepareTranslation, type PreparedTranslation } from '../src/shared/translation'
let snapshot: TranslationSnapshot
beforeEach(() => { snapshot = { sessionId: 'A', source: 'Hello world.', targetLang: 'zh-CN' } })
afterEach(() => vi.unstubAllGlobals())
async function artifact(source = snapshot.source, targetLang = 'zh-CN'): Promise<PreparedTranslation> {
  const prepared = await prepareTranslation(source)
  return { version: 1, sourceHash: prepared.sourceHash, sourceLang: 'en', targetLang,
    blocks: prepared.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id, text: '你好世界。' })) }
}
function response(body: unknown, status = 200) { return { ok: status === 200, status, json: async () => body } as Response }
function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>((r) => { resolve = r }); return { promise, resolve } }

it('loads one complete prepared artifact by GET without generating translations', async () => {
  const prepared = await artifact()
  const fetch = vi.fn().mockResolvedValue(response(prepared))
  vi.stubGlobal('fetch', fetch)
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]![0]).toBe('/api/sessions/A/translation?targetLang=zh-CN')
  expect(fetch.mock.calls[0]![1]).toBeUndefined()
  expect(store.getState().active).toBe(true)
})
it.each([404, 409, 500])('falls back to original after HTTP %i with no retained artifact', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'missing' }, status)))
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  expect(store.getState().active).toBe(false)
  expect(store.getState().artifact).toBeNull()
  expect(store.getState().loading).toBe(false)
  expect(store.getState().error).toBe(status === 404 ? 'missing' : status === 409 ? 'stale' : 'unavailable')
})
it('retains prepared narrative across comments and highlights but invalidates prose and suggestions', async () => {
  const prepared = await artifact()
  const fetch = vi.fn().mockResolvedValue(response(prepared)); vi.stubGlobal('fetch', fetch)
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  snapshot.source = '{==Hello==} world.{>>@Da Wei: 中文评论<<}'
  await store.getState().synchronize()
  expect(store.getState().active).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(1)
  snapshot.source = 'Hello {++new++} world.'
  await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
  expect(store.getState().artifact).toBeNull()
  expect(store.getState().error).toBe('stale')
})
it.each(['navigation', 'language', 'edit'])('rejects a slow load after %s', async (change) => {
  const prepared = await artifact()
  const pending = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise))
  const store = createTranslationStore(() => snapshot)
  const load = store.getState().toggle()
  snapshot = change === 'navigation' ? { ...snapshot, sessionId: 'B' }
    : change === 'language' ? { ...snapshot, targetLang: 'ja' } : { ...snapshot, source: 'Changed prose.' }
  await store.getState().synchronize()
  pending.resolve(response(prepared)); await load
  expect(store.getState().active).toBe(false)
  expect(store.getState().artifact).toBeNull()
  expect(store.getState().loading).toBe(false)
})
it('validates against comments added while the artifact request is in flight', async () => {
  const prepared = await artifact()
  const pending = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise))
  const store = createTranslationStore(() => snapshot)
  const load = store.getState().toggle()
  snapshot.source += '{>>@Da Wei: note<<}'
  await store.getState().synchronize()
  pending.resolve(response(prepared)); await load
  expect(store.getState().active).toBe(true)
  expect(store.getState().source).toBe(snapshot.source)
})
it('rejects an artifact whose target or complete block set does not match', async () => {
  const prepared = await artifact()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...prepared, blocks: [], targetLang: 'ja' })))
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  expect(store.getState().active).toBe(false)
  expect(store.getState().error).toBe('stale')
})
it('does not issue requests when translation is disabled', async () => {
  snapshot.targetLang = null
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const store = createTranslationStore(() => snapshot)
  await store.getState().toggle()
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps the latest document artifact when requests complete in reverse order', async () => {
  const prepared = await artifact()
  const first = deferred(); const second = deferred()
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
  const store = createTranslationStore(() => snapshot)
  const a = store.getState().toggle()
  snapshot = { ...snapshot, sessionId: 'B' }
  await store.getState().synchronize()
  const b = store.getState().toggle()
  second.resolve(response(prepared)); await b
  expect(store.getState().sessionId).toBe('B')
  expect(store.getState().active).toBe(true)
  first.resolve(response({ ...prepared, blocks: [] })); await a
  expect(store.getState().sessionId).toBe('B')
  expect(store.getState().active).toBe(true)
  expect(store.getState().error).toBeNull()
})

it('stays original after toggling off and then changing annotations or narrative', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(await artifact())))
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
