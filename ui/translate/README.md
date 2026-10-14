# Prepared reading translations

The browser reads a complete prepared artifact through `getPreparedTranslation`; it does not ask
for generation. The Translation language preference (`translationLanguage`) chooses the target,
with `null` selecting original-only reading. The artifact supplies its source language. Repository
language discovery remains separate.

`translationStore.ts` keeps request generation, document, target, and validated source together.
Every loaded artifact is checked by the shared snapshot matcher against the current buffer, even
when disk still contains an older version. Navigation and target changes discard prior artifacts.
Source changes hide the translated view until validation completes: review annotations can reuse
an artifact, while changed translation input falls back to original with a visible reason. A late
response cannot restore a previous document or target. Missing, stale, or invalid artifacts never
become a partially translated current view.

`TranslatedView.tsx` renders the shared translation projection with current source block identities
and preserves literal blocks. Its Markdown renderer receives no mutation handler. Existing comments
remain accessible in their authored language below the translated text.

`TranslatedSelection.tsx` accepts a selection inside one translated block. The composer captures
its exact visible text and target language; submission revalidates the document and artifact before
asking the shared comment helper for a current source splice. The splice uses the ordinary review
undo/autosave path. It does not alter translated prose. `CommentBody.tsx` decodes the shared comment
payload for literal quote and authored-body display, including in the resolved archive view.

The composer is mounted beside the transient translated prose subtree. Its identity follows the
document, translation fingerprint, and target, so annotation-only revalidation retains typed drafts.
A translation-input mismatch preserves the draft with a stale-selection warning and refuses
submission; toggling back to original, changing language, or navigating closes that translated
composer.

An open translated comment captures its artifact and exact selected passage. A newer artifact
retains the draft but disables submission against the old selection; it never silently rebinds the
comment to different translated text.
