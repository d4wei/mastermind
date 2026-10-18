# Review draft lifetime

`DraftScope` gives composers a document identity. `useDraftState` retains their input and captured
selection in memory across file, panel, and mode changes. `useDraftGuard` identifies meaningful
unfinished work and supplies the original composer's focus and discard actions. Empty composers do
not block close; a changed suggested replacement is meaningful even when it is empty (deletion).

Closing offers Discard Drafts or Cancel before dealing with accepted document edits. Cancel selects
the owning file, restores reading mode and the comments panel, and focuses the original composer.
The close dialog has no duplicate text input. Discard affects only the drafts named in the prompt;
no draft is implicitly submitted or included in a saved Markdown copy.

Selection drafts retain their source snapshot and cannot submit against changed source offsets.
Replies retain their thread identity. If that thread disappears, their text remains copyable in the
comments rail; it is not posted against a guessed target. Translated drafts retain their captured
artifact and use the translation checks before submission. Automatic target relocation is deferred.

Save As transfers retained drafts to the admitted copy; closing releases the document's draft state.
This registry is temporary app memory. It does not implement restart recovery or change the
Markdown file's authority for accepted review feedback.
