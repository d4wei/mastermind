# Prepared reading translations

The language menu offers Original and the valid prepared translations for the current document.
It appears only when a translation is available. Labels use native language names with regional
qualifiers; Interface language controls surrounding copy. The menu uses Radix keyboard navigation,
focus return, and outside dismissal. Find and the file list dismiss it; opening it closes Find
and the file list. Long names truncate in the toolbar and remain readable in the menu and tooltip.

`translationStore.ts` owns reading choices per open document for the app session. Opening defaults
to Original. `open --language CODE -- FILE...` supplies a presentation hint: use a matching valid
artifact once, unless the reader has already chosen a version. A missing artifact leaves Original;
its later arrival does not switch the reader. Closing forgets the choice. Markdown view always
shows the original source; returning to reading retains the current valid translation.

The host discovers artifacts beside the admitted document. Native directory watches and periodic
revalidation cover creation, replacement, deletion, and missed events; discovery never generates
text. `translationStore.ts` validates every candidate against the current buffer independently,
including before selection. Request generations discard late results for old documents or choices.
Review-only source changes preserve artifact identity. Narrative changes hide translated prose
until validation and fall back to Original with a dismissible notice if the selection is stale.
A failed background discovery on Original does not warn or block reading.

`TranslatedView.tsx` renders the shared projection, preserves literal blocks, and has no mutation
handler. Existing comments remain in their authored language. Find searches the displayed version.
Heading blocks carry their source offsets, so the outline navigates the translated view; offsets
inside a block refer to its displayed text and are not rendered.

`TranslatedSelection.tsx` captures one block's exact passage, language, and artifact. Submission
rereads the artifact and revalidates the current source, selected language, and captured passage
before producing an exact comment splice in the original Markdown. It uses ordinary undo/autosave
and never edits translated prose. A replaced artifact cannot silently rebind an unfinished quote:
the draft stays available with a stale-selection warning. Annotation-only validation reuses the
same artifact object.

Changing reading versions with an unfinished review draft uses the existing Cancel / Discard draft
policy. Cancel focuses the draft; discard must be chosen before switching. Navigation retains drafts
through the shared draft store. Persistence across app restarts remains deferred.
