# Source editor lifetime

The document store owns the source and its revision. CodeMirror owns Markdown-mode undo history
and selection; its immutable `EditorState` is retained per document for the lifetime of the app.
Returning to Markdown mode or switching back to a document reuses that state only when both the
source text and the retained document revision still match. An outside edit, including an edit
reverted to identical text, invalidates old editor history through the document revision.

Each mount creates a fresh `EditorView` and transaction adapter. The adapter updates the view and
pushes document changes into the store only while the captured document and external version are
current. No callback tied to an old mount lives in the retained state. Cleanup retains state,
unregisters only its own flusher and outline callbacks, and destroys the view; it never flushes stale content
over an adopted buffer. Views and DOM nodes are not cached.

CodeMirror history remains separate from the store's undo stack for review operations performed
outside Markdown mode. Retention uses the existing CodeMirror history extension and adds no second
source-editor undo stack. The cache has the same app lifetime as retained document buffers.

Outline navigation uses CodeMirror's line-block geometry rather than requiring a rendered DOM line.
The mounted view reports heading-position and scroll callbacks to the document view through
`onOutline` and clears its own report on unmount.
Source offsets already use the document store's LF-normalized buffer. Navigation dispatches
CodeMirror's scroll effect so it can remeasure virtualized lines before aligning the target in
the document scroller, below the fixed controls.
