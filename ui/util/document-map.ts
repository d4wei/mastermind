import { useDoc } from '../documents/store'

/** A module-lifetime map keyed by document id that drops each entry once its document closes. */
export function documentMap<V>(): Map<string, V> {
  const entries = new Map<string, V>()
  useDoc.subscribe((state) => {
    for (const id of entries.keys()) if (!state.hasDocument(id)) entries.delete(id)
  })
  return entries
}
