import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState, RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { scanMarkdown } from '../../../document/markdown/scan'
import { useDoc } from '../../documents/store'
import { useNav } from '../../app/navStore'

const CRITIC_CLASS: Record<string, string> = {
  ins: 'cm-critic cm-critic-ins',
  del: 'cm-critic cm-critic-del',
  sub: 'cm-critic cm-critic-sub',
  highlight: 'cm-critic cm-critic-hl',
  comment: 'cm-critic cm-critic-comment',
}

function computeDecorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString()
  const builder = new RangeSetBuilder<Decoration>()
  try {
    for (const span of scanMarkdown(text)) {
      builder.add(span.start, span.end, Decoration.mark({ class: CRITIC_CLASS[span.kind]! }))
    }
  } catch {
    // A scanning failure must not interrupt editor input.
  }
  return builder.finish()
}

const criticHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = computeDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = computeDecorations(update.view)
    }
  },
  { decorations: (v) => v.decorations },
)

const sourceTheme = EditorView.theme({
  '&': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.875rem',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    caretColor: 'var(--color-text)',
    lineHeight: '1.7',
    padding: '0',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--color-text)' },
})

const editing = new Compartment()
const editingState = (paused: boolean) => [EditorState.readOnly.of(paused), EditorView.editable.of(!paused)]

const retainedStates = new Map<string, { state: EditorState; revision: number }>()
useDoc.subscribe((state) => {
  for (const id of retainedStates.keys()) {
    if (!state.hasDocument(id)) retainedStates.delete(id)
  }
})

export function SourceEditor() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sessionId = useDoc((s) => s.sessionId)
  const externalVersion = useDoc((s) => s.externalVersion)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !sessionId) return
    const { source: entry, revision: entryRevision } = useDoc.getState()
    let revision = entryRevision
    const retained = retainedStates.get(sessionId)
    const ownsBuffer = (): boolean => useDoc.getState().sessionId === sessionId &&
      useDoc.getState().externalVersion === externalVersion

    const state = retained?.revision === revision && retained.state.doc.toString() === entry
      ? retained.state : EditorState.create({
          doc: entry,
          extensions: [
            history(),
            editing.of(editingState(useDoc.getState().conflict)),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            markdown(),
            EditorView.lineWrapping,
            criticHighlighter,
            sourceTheme,
          ],
        })
    const view = new EditorView({
      state,
      parent: host,
      dispatchTransactions(transactions, currentView) {
        if (ownsBuffer() && useDoc.getState().conflict && transactions.some((transaction) => transaction.docChanged)) return
        currentView.update(transactions)
        if (transactions.some((transaction) => transaction.docChanged) && ownsBuffer()) {
          useDoc.getState().setSourceFromEditor(currentView.state.doc.toString())
          revision = useDoc.getState().revision
        }
      },
    })

    view.dispatch({ effects: editing.reconfigure(editingState(useDoc.getState().conflict)) })
    const stop = useDoc.subscribe((state, previous) => {
      if (ownsBuffer() && state.conflict !== previous.conflict) {
        view.dispatch({ effects: editing.reconfigure(editingState(state.conflict)) })
      }
    })

    const flush = (): void => {
      const text = view.state.doc.toString()
      if (ownsBuffer() && text !== useDoc.getState().source) useDoc.getState().setSourceFromEditor(text)
    }
    useDoc.getState().registerFlusher(flush)
    const registeredFlusher = useDoc.getState().flushEditor
    const editorPosition = (offset: number): number => Math.min(Math.max(offset, 0), view.state.doc.length)
    const sourceHeadingTop = (offset: number): number =>
      view.documentTop + view.lineBlockAt(editorPosition(offset)).top
    useNav.setState({ sourceHeadingTop })
    useDoc.getState().registerScroller((offset) => {
      const pos = editorPosition(offset)
      // CodeMirror remeasures virtualized lines before scrolling its ancestor viewport.
      view.dispatch({ selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) })
    })

    const registeredScroller = useDoc.getState().scroller
    return () => {
      // Retain immutable state only. Cleanup must not flush an externally replaced buffer.
      if (useDoc.getState().hasDocument(sessionId)) retainedStates.set(sessionId, { state: view.state, revision })
      if (useDoc.getState().flushEditor === registeredFlusher) useDoc.getState().registerFlusher(null)
      if (useDoc.getState().scroller === registeredScroller) useDoc.getState().registerScroller(null)
      if (useNav.getState().sourceHeadingTop === sourceHeadingTop) useNav.setState({ sourceHeadingTop: null })
      stop()
      view.destroy()
    }
  }, [sessionId, externalVersion])

  return <div ref={hostRef} className="source-host" />
}
