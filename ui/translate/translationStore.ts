import { create } from 'zustand'
import { matchPreparedTranslation, type PreparedTranslation } from '../../document/translation'
import { HostError, requireReviewerHost } from '../app/host'
import { useDoc } from '../documents/store'
import { useConfig } from '../app/configStore'

export interface TranslationSnapshot { sessionId: string | null; source: string; targetLang: string | null }
interface TransState extends TranslationSnapshot {
  active: boolean
  loading: boolean
  artifact: PreparedTranslation | null
  error: 'missing' | 'stale' | 'unavailable' | null
  synchronize(): Promise<void>
  toggle(): Promise<void>
  reset(): void
}

export function createTranslationStore(current: () => TranslationSnapshot) {
  let generation = 0
  const sameIdentity = (snapshot: TranslationSnapshot) => {
    const now = current()
    return now.sessionId === snapshot.sessionId && now.targetLang === snapshot.targetLang
  }
  const validate = async (raw: unknown, token: number, snapshot: TranslationSnapshot): Promise<void> => {
    while (token === generation && sameIdentity(snapshot)) {
      const now = current()
      const artifact = await matchPreparedTranslation(now.source, raw)
      if (token !== generation || !sameIdentity(snapshot)) return
      if (current().source !== now.source) continue
      const matches = artifact !== null && artifact.targetLang === now.targetLang
      store.setState({ ...now, artifact: matches ? artifact : null, active: matches,
        loading: false, error: matches ? null : 'stale' })
      return
    }
  }
  const store = create<TransState>((set, get) => ({
    sessionId: null, source: '', targetLang: null, active: false, loading: false, artifact: null, error: null,
    async synchronize() {
      const now = current()
      const state = get()
      if (!sameIdentity(state)) {
        generation++
        set({ ...now, active: false, loading: false, artifact: null, error: null })
        return
      }
      if (now.source === state.source) return
      set({ source: now.source, active: false })
      if (state.loading) return
      if (state.artifact) await validate(state.artifact, ++generation, now)
    },
    async toggle() {
      if (get().active || get().loading) {
        generation++
        set({ active: false, loading: false, artifact: null, error: null })
        return
      }
      const snapshot = current()
      if (!snapshot.sessionId || !snapshot.targetLang) return
      const token = ++generation
      set({ ...snapshot, active: false, loading: true, artifact: null, error: null })
      try {
        const raw = await requireReviewerHost().translation(snapshot.sessionId, snapshot.targetLang)
        await validate(raw, token, snapshot)
      } catch (error) {
        if (token !== generation || !sameIdentity(snapshot)) return
        set({ ...current(), active: false, loading: false, artifact: null,
          error: error instanceof HostError && error.kind === 'missing' ? 'missing'
            : error instanceof HostError && error.kind === 'conflict' ? 'stale' : 'unavailable' })
      }
    },
    reset() {
      generation++
      set({ sessionId: null, source: '', targetLang: null, active: false, loading: false, artifact: null, error: null })
    },
  }))
  return store
}

export const useTranslation = createTranslationStore(() => ({
  sessionId: useDoc.getState().sessionId,
  source: useDoc.getState().source,
  targetLang: useConfig.getState().config?.translationLanguage ?? null,
}))
