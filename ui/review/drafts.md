# Review draft lifetime

`DraftScope` gives composers a document identity. `useDraftState` retains their input and captured
selection in memory across file, panel, and mode changes. `useDraftGuard` identifies meaningful
unfinished work and supplies the original composer's focus and discard actions. One store keyed by
document id holds each document's retained values and meaningful drafts, together with the draft
awaiting focus; document views read it reactively. Empty composers do
not block close; a changed suggested replacement is meaningful even when it is empty (deletion).

Closing offers Discard Drafts or Cancel before dealing with accepted document edits. Cancel selects
the owning file, restores reading mode and the comments panel, and focuses the original composer.
The close dialog has no duplicate text input. Discard affects only the drafts named in the prompt;
no draft is implicitly submitted or included in a saved Markdown copy.

Selection drafts retain their source snapshot and cannot submit against changed source offsets.
Replies retain their thread identity and start offset, and belong to the document view rather than
the comments rail, so edits made while the narrow comments panel is closed still reach them. Review
edits carry a reply exactly. After a change of unknown shape, such as an external edit, a reply
follows its discussion to the offset on which both alignments of the changed region agree, or else
by identity alone when that identity was unique before the change and still is. A reply whose
target is ambiguous or gone remains copyable in the comments rail, with a Discard draft control; it
is not posted against a guessed target. Translated drafts retain their captured artifact and use
the translation checks before submission.

Save As transfers retained drafts to the admitted copy; closing releases the document's draft state.
Prompts list drafts in the order they became meaningful, across documents.
This store is temporary app memory. It does not implement restart recovery or change the
Markdown file's authority for accepted review feedback.
