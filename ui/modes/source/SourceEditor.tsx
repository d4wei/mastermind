import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState, RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { scanMarkdown } from '../../../document/markdown/scan'
import { editingLocked, useDoc } from '../../documents/store'
import { attachSourceSearch, sourceSearchExtension } from '../../find/source'
import type { SourceOutline } from '../../app/Navigator'
import { documentMap } from '../../util/document-map'

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

const retainedStates = documentMap<{ state: EditorState; revision: number }>()

/** `onOutline` receives the mounted view's heading geometry and navigation, and null on unmount. */
export function SourceEditor({ onOutline }: { onOutline: Dispatch<SetStateAction<SourceOutline | null>> }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const reportOutline = useRef(onOutline)
  reportOutline.current = onOutline
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
            editing.of(editingState(editingLocked(useDoc.getState()))),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            markdown(),
            EditorView.lineWrapping,
            criticHighlighter,
            sourceTheme,
            sourceSearchExtension,
          ],
        })
    let searchBinding: ReturnType<typeof attachSourceSearch> | undefined
    const view = new EditorView({
      state,
      parent: host,
      dispatchTransactions(transactions, currentView) {
        if (ownsBuffer() && editingLocked(useDoc.getState()) && transactions.some((transaction) => transaction.docChanged)) return
        for (const transaction of transactions) searchBinding?.mapSelection(transaction.changes)
        currentView.update(transactions)
        // Owned changes reach the store synchronously, so saves and navigation never flush the editor.
        if (transactions.some((transaction) => transaction.docChanged) && ownsBuffer()) {
          useDoc.getState().setSourceFromEditor(currentView.state.doc.toString())
          revision = useDoc.getState().revision
        }
      },
    })

    searchBinding = attachSourceSearch(view, sessionId)
    // A new state is built with the current lock; a retained one carries the lock from when it was left.
    if (state === retained?.state) view.dispatch({ effects: editing.reconfigure(editingState(editingLocked(useDoc.getState()))) })
    const stop = useDoc.subscribe((state, previous) => {
      if (ownsBuffer() && editingLocked(state) !== editingLocked(previous)) {
        view.dispatch({ effects: editing.reconfigure(editingState(editingLocked(state))) })
      }
    })

    const editorPosition = (offset: number): number => Math.min(Math.max(offset, 0), view.state.doc.length)
    const sourceOutline: SourceOutline = {
      headingTop: (offset) => view.documentTop + view.lineBlockAt(editorPosition(offset)).top,
      scrollTo(offset) {
        const pos = editorPosition(offset)
        // CodeMirror remeasures virtualized lines before scrolling its ancestor viewport.
        view.dispatch({ selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) })
      },
    }
    reportOutline.current(sourceOutline)

    return () => {
      searchBinding?.dispose()
      // Retain immutable state only. Cleanup must not flush an externally replaced buffer.
      if (useDoc.getState().hasDocument(sessionId)) retainedStates.set(sessionId, { state: view.state, revision })
      reportOutline.current((current) => current === sourceOutline ? null : current)
      stop()
      view.destroy()
    }
  }, [sessionId, externalVersion])

  return <div ref={hostRef} className="source-host" />
}
