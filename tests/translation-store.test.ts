import { fakeHost } from './helpers/host'
import { installHost } from '../ui/app/host'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTranslationStore, type TranslationSnapshot } from '../ui/translate/translationStore'
import { prepareTranslation, type PreparedTranslation } from '../document/translation'
let snapshot: TranslationSnapshot
let artifacts: unknown[]
let reads: ReturnType<typeof vi.fn<(id: string) => Promise<unknown[]>>>
beforeEach(() => {
  snapshot = { sessionId: 'A', source: 'Hello world.' }
  artifacts = []
  reads = vi.fn(async () => artifacts)
  installHost(fakeHost({ translations: reads }))
})
afterEach(() => installHost(null))
async function artifact(targetLang = 'zh-CN', source = snapshot.source): Promise<PreparedTranslation> {
  const prepared = await prepareTranslation(source)
  return { version: 1, sourceHash: prepared.sourceHash, sourceLang: 'en', targetLang,
    blocks: prepared.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id, text: 'Translated text.' })) }
}
function deferred() { let resolve!: (value: unknown[]) => void; const promise = new Promise<unknown[]>((r) => { resolve = r }); return { promise, resolve } }

it('starts with original and discovers languages independently without generation', async () => {
  artifacts = [await artifact(), await artifact('fr'), { invalid: true }, await artifact('ja', 'Old prose')]
  const store = createTranslationStore(() => snapshot)
  await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
  expect(store.getState().available.map((a) => a.targetLang)).toEqual(['fr', 'zh-CN'])
  await store.getState().select('fr')
  expect(store.getState().artifact?.targetLang).toBe('fr')
  expect(reads).toHaveBeenCalledWith('A')
})
it('retains independent choices per open file and forgets a closed file', async () => {
  artifacts = [await artifact(), await artifact('fr')]
  const store = createTranslationStore(() => snapshot)
  await store.getState().select('fr')
  snapshot.sessionId = 'B'; await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
  await store.getState().select('zh-CN')
  snapshot.sessionId = 'A'; await store.getState().synchronize()
  expect(store.getState().targetLang).toBe('fr')
  store.getState().release('A'); await store.getState().synchronize()
  expect(store.getState().targetLang).toBeNull()
})
it('keeps a selected artifact identity across annotations but invalidates narrative', async () => {
  artifacts = [await artifact()]
  const store = createTranslationStore(() => snapshot)
  await store.getState().select('zh-CN')
  const captured = store.getState().artifact
  snapshot.source = '{==Hello==} world.{>>@Alex: note<<}'
  await store.getState().synchronize()
  expect(store.getState().artifact).toBe(captured)
  snapshot.source = 'Hello {++new++} world.'
  await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
  expect(store.getState().error).toBe('stale')
  expect(store.getState().targetLang).toBeNull()
})
it('discovers creation, replacement and deletion without silently switching original', async () => {
  const store = createTranslationStore(() => snapshot)
  await store.getState().synchronize()
  expect(store.getState().available).toEqual([])
  artifacts = [await artifact()]; await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
  await store.getState().select('zh-CN')
  const captured = store.getState().artifact!
  artifacts = [{ ...captured, blocks: captured.blocks.map((block) => ({ ...block, text: 'New translation' })) }]
  await store.getState().synchronize()
  expect(store.getState().artifact).not.toBe(captured)
  artifacts = []; await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
  expect(store.getState().error).toBe('stale')
  artifacts = [captured]; await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
})
it('applies a valid hint once, without overriding an explicit original choice', async () => {
  artifacts = [await artifact()]
  const store = createTranslationStore(() => snapshot)
  store.getState().hint('A', 'zh-CN'); await store.getState().synchronize()
  expect(store.getState().targetLang).toBe('zh-CN')
  await store.getState().select(null)
  store.getState().hint('A', 'fr'); await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
})
it('ignores unavailable hints and does not auto-switch when that artifact arrives', async () => {
  const store = createTranslationStore(() => snapshot)
  store.getState().hint('A', 'zh-CN'); await store.getState().synchronize()
  expect(store.getState().error).toBeNull()
  artifacts = [await artifact()]; await store.getState().synchronize()
  expect(store.getState().active).toBe(false)
})
it('late discovery cannot replace a newer document or choice', async () => {
  const prepared = await artifact()
  const pending = deferred(); reads.mockReturnValueOnce(pending.promise)
  const store = createTranslationStore(() => snapshot)
  const first = store.getState().select('zh-CN')
  snapshot.sessionId = 'B'; artifacts = [await artifact('fr')]
  await store.getState().select('fr')
  pending.resolve([prepared]); await first
  expect(store.getState().sessionId).toBe('B')
  expect(store.getState().targetLang).toBe('fr')
})
it('validates the latest source when an artifact arrives during editing', async () => {
  const prepared = await artifact()
  const pending = deferred(); reads.mockReturnValueOnce(pending.promise)
  const store = createTranslationStore(() => snapshot)
  const loading = store.getState().select('zh-CN')
  snapshot.source += '{>>@Alex: note<<}'
  pending.resolve([prepared]); await loading
  expect(store.getState().active).toBe(true)
  expect(store.getState().source).toBe(snapshot.source)
})
it('source edits while original is selected do not cause warnings', async () => {
  artifacts = [await artifact()]
  const store = createTranslationStore(() => snapshot)
  await store.getState().synchronize()
  snapshot.source = 'Changed.'; await store.getState().synchronize()
  expect(store.getState().error).toBeNull()
  expect(store.getState().available).toEqual([])
})
it('discovery failures only notify when a displayed translation is lost', async () => {
  const store = createTranslationStore(() => snapshot)
  reads.mockRejectedValueOnce(new Error('Unavailable'))
  await store.getState().synchronize()
  expect(store.getState().error).toBeNull()
  artifacts = [await artifact()]; await store.getState().select('zh-CN')
  reads.mockRejectedValueOnce(new Error('Unavailable'))
  await store.getState().synchronize()
  expect(store.getState().error).toBe('unavailable')
  expect(store.getState().active).toBe(false)
})
