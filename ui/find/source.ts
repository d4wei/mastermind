import { closeSearchPanel, openSearchPanel, search, setSearchQuery } from '@codemirror/search'
import { EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { create } from 'zustand'
import { searchQuery, type Match } from './matches'

// CodeMirror enables match decorations through its panel lifecycle; React owns the visible controls.
export const sourceSearchExtension = search({
  literal: true,
  createPanel: () => {
    const dom = document.createElement('div')
    dom.hidden = true
    dom.className = 'cm-find-placeholder'
    return { dom }
  },
})

interface SourceSearch {
  sessionId: string
  matches(query: string, caseSensitive: boolean): Match[]
  query(query: string, caseSensitive: boolean): void
  select(match: Match, panel: HTMLElement | null): void
  start(): number
  selection(): string
  close(): void
  focus(): void
}
export const useSourceSearch = create<{ adapter: SourceSearch | null }>(() => ({ adapter: null }))

function sourceMatches(state: EditorState, query: string, caseSensitive: boolean): Match[] {
  if (!query) return []
  const cursor = searchQuery(query, caseSensitive).getCursor(state)
  const matches: Match[] = []
  for (let next = cursor.next(); !next.done; next = cursor.next()) matches.push({ from: next.value.from, to: next.value.to })
  return matches
}

export function attachSourceSearch(view: EditorView, sessionId: string) {
  let original: EditorSelection | null = null
  let disposed = false
  const adapter: SourceSearch = {
    sessionId,
    matches: (query, caseSensitive) => sourceMatches(view.state, query, caseSensitive),
    query(query, caseSensitive) {
      if (disposed) return
      original ??= view.state.selection
      openSearchPanel(view)
      view.dispatch({ effects: setSearchQuery.of(searchQuery(query, caseSensitive)) })
    },
    select(match, panel) {
      const viewport = document.querySelector('.document-scroll')?.getBoundingClientRect()
      const margin = Math.max(12, (panel?.getBoundingClientRect().bottom ?? 0) - (viewport?.top ?? 0) + 12)
      view.dispatch({ selection: EditorSelection.single(match.from, match.to),
        effects: EditorView.scrollIntoView(match.from, { y: 'nearest', yMargin: margin }) })
    },
    start: () => original?.main.from ?? view.state.selection.main.from,
    selection: () => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
    close() {
      if (disposed) return
      closeSearchPanel(view)
      view.dispatch({ effects: setSearchQuery.of(searchQuery('', false)), ...(original ? { selection: original } : {}) })
      original = null
    },
    focus: () => view.focus(),
  }
  useSourceSearch.setState({ adapter })
  return {
    mapSelection(changes: import('@codemirror/state').ChangeDesc) { original = original?.map(changes) ?? null },
    dispose() {
      adapter.close()
      disposed = true
      if (useSourceSearch.getState().adapter === adapter) useSourceSearch.setState({ adapter: null })
    },
  }
}
