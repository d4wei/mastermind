import { create } from 'zustand'
import { matchPreparedTranslation, type PreparedTranslation } from '../../document/translation'
import { requireReviewerHost } from '../app/host'
import { useDoc } from '../documents/store'

export interface TranslationSnapshot { sessionId: string | null; source: string }
interface Choice { language: string | null; chosen: boolean; hinted: boolean }
interface TransState extends TranslationSnapshot {
  targetLang: string | null
  active: boolean
  loading: boolean
  artifact: PreparedTranslation | null
  available: PreparedTranslation[]
  error: 'stale' | 'unavailable' | null
  synchronize(): Promise<void>
  select(language: string | null): Promise<void>
  hint(id: string, language: string): void
  release(id: string): void
  reset(): void
}

export function createTranslationStore(current: () => TranslationSnapshot) {
  let generation = 0
  const choices = new Map<string, Choice>()
  const hints = new Map<string, string>()
  const choice = (id: string) => {
    if (!choices.has(id)) choices.set(id, { language: null, chosen: false, hinted: false })
    return choices.get(id)!
  }
  const store = create<TransState>((set, get) => ({
    sessionId: null, source: '', targetLang: null, active: false, loading: false,
    artifact: null, available: [], error: null,
    async synchronize() {
      const snapshot = current()
      if (!snapshot.sessionId) return
      const id = snapshot.sessionId
      const token = ++generation
      const previous = get()
      if (previous.sessionId !== id) {
        set({ ...snapshot, targetLang: null, active: false, artifact: null, available: [], error: null, loading: true })
      }
      if (previous.sessionId === id && previous.source !== snapshot.source) set({ active: false })
      try {
        const raw = await requireReviewerHost().translations(id)
        while (token === generation && current().sessionId === id) {
          const now = current()
          const candidates = await Promise.all(raw.map((value) => matchPreparedTranslation(now.source, value)))
          if (token !== generation || current().sessionId !== id) return
          if (now.source !== current().source) continue
          const available = candidates.filter((item): item is PreparedTranslation => !!item)
            .sort((a, b) => a.targetLang.localeCompare(b.targetLang))
            .map((item) => previous.available.find((old) => JSON.stringify(old) === JSON.stringify(item)) ?? item)
          const selected = choice(id)
          if (!selected.chosen && !selected.hinted && hints.has(id)) {
            selected.hinted = true
            const hint = hints.get(id)!
            if (available.some((item) => item.targetLang === hint)) selected.language = hint
          }
          const artifact = available.find((item) => item.targetLang === selected.language) ?? null
          const invalidated = selected.language !== null && !artifact
          if (invalidated) selected.language = null
          set({ ...now, targetLang: selected.language, active: !!artifact, artifact, available, loading: false,
            error: invalidated ? 'stale' : previous.sessionId === id ? previous.error : null })
          return
        }
      } catch {
        if (token !== generation || current().sessionId !== id) return
        const selected = choice(id)
        const hadTranslation = selected.language !== null
        selected.language = null
        set({ ...current(), targetLang: null, active: false, artifact: null, available: [], loading: false,
          error: hadTranslation ? 'unavailable' : null })
      }
    },
    async select(language) {
      const { sessionId } = current()
      if (!sessionId) return
      const selected = choice(sessionId)
      selected.language = language
      selected.chosen = true
      set({ active: false, artifact: null, targetLang: language, error: null })
      await get().synchronize()
    },
    hint(id, language) {
      if (hints.get(id) === language) return
      hints.set(id, language)
      if (current().sessionId === id && !choice(id).chosen && !choice(id).hinted) void get().synchronize()
    },
    release(id) { choices.delete(id); hints.delete(id); if (get().sessionId === id) get().reset() },
    reset() {
      generation++
      set({ sessionId: null, source: '', targetLang: null, active: false, loading: false,
        artifact: null, available: [], error: null })
    },
  }))
  return store
}

export const useTranslation = createTranslationStore(() => ({
  sessionId: useDoc.getState().sessionId,
  source: useDoc.getState().source,
}))
