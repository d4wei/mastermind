---
status: living
updated: 2026-10-25
exit: Ship the selection contract, move it beside the implementation, and delete this design.
---

# Reliable review selections

A reader should be able to select ordinary rendered prose without understanding Markdown syntax.
The selection toolbar must distinguish an unsupported target from an interaction that failed. This
plan replaces the narrower partial-formatting fix; production behavior is unchanged pending review.

## Findings in the current implementation

The audit covers the original-language mapper, its renderer and edit validator, and the separate
translated-selection path. Evidence lives in `ui/modes/reading/selection.ts`, `selection.md`,
`SelectionToolbar.tsx`, `Renderer.tsx`, `marks.ts`, `document/markdown/exclusions.ts`, and
`ui/translate/TranslatedSelection.tsx`.

- **Partial formatting:** crossing part of bold, italic, strikethrough, or a link can fail for the
  whole piece. This is an implementation limitation; preserve wrappers and map the selected text.
- **Complete formatting:** supported wrappers map with their exact source syntax. Retain this when
  the whole visible wrapper is selected.
- **Entities, escapes, and repeated text:** unequal source/rendered lengths trigger a unique-text
  fallback. Transformed or repeated text can fail because positional provenance is missing.
- **Reference links and breaks:** ranges crossing unaccounted source gaps can fail. These need
  parser-backed mapping rather than guessed offsets.
- **Generated labels:** footnote and image-reference labels lack direct text provenance. Distinguish
  generated display from selectable source text.
- **Partial inline code:** refused; a whole code span can be wrapped outside its backticks.
  Delimiters inside code are literal, so offer an explicit alternative.
- **Opaque blocks:** fenced/indented code, raw HTML, and frontmatter are refused or skipped. The
  current protocol cannot encode active inline marks inside them.
- **Existing marks:** rendered marks are skipped; overlapping source spans are dropped. Avoid
  nesting, but retain the selected passage and explain alternatives.
- **Invisible review ownership:** standalone highlights or literal review spans without a rendered
  mark wrapper can cause an ordinary-looking piece to be dropped.
- **Multiple blocks:** paragraphs, list items, and table cells become separate editable fragments.
  Each mark must fit within one text block under the current protocol.
- **Missing provenance:** no eligible block, missing positions, and DOM/source mismatch all yield a
  generic mapping error. They need specific diagnoses.
- **Partial success:** unmappable pieces are dropped while actions remain available for the rest.
  This silently loses selection coverage.
- **Multi-fragment comments:** only the first fragment anchors the comment. Show that scope or offer
  a quoted-passage fallback.
- **Translated blocks:** selecting across blocks hides the toolbar. The current comment contract
  covers one translated block; explain that limit.
- **Inactivity:** empty selections and selections outside the document need no toolbar or warning.

The toolbar converts every mapping error to no toolbar. Later failures are different: stale drafts,
paused editing, and invalid CriticMarkup already have composer messages. Those messages need to fit
the same interaction model, but should not be conflated with source mapping.

The edit validator checks the intended review spans and preservation of existing spans. It does not
establish that all surrounding Markdown still renders with the same structure. The redesign must
check formatting as well as mark recognition, especially for reference links and delimiter edges.

## Smallest necessary restrictions

Separate three questions: where the selected content came from, how the requested operation can be
encoded, and whether the captured document revision is still current. Failure of one operation must
not erase other valid actions.

Ordinary prose should remain selectable across formatting, decoded entities, escapes, line endings,
container prefixes, and block boundaries. Repeated text is only ambiguous when provenance is lost.
It is not inherently an ambiguous selection.

Under the current file protocol, the unavoidable restrictions are narrower:

- Never guess a source location or apply a captured selection to a different revision.
- Never insert active review delimiters inside opaque syntax or nest them inside existing marks.
- Keep each review mark within its supported text block and preserve unrelated source bytes.
- Do not silently broaden, shorten, or substitute the selected target.

These restrict the encoding of an inline edit. They need not prohibit a discussion about the
passage.
A truly unmappable selection may still be copied; it must not be attached to an arbitrary location.

## Proposed behavior

Keep feedback beside the selection, in the existing floating toolbar/composer. Do not raise global
notifications for ordinary selection limits or display warnings during every intermediate drag.
Wait for a settled nonempty document selection; support keyboard selection, Escape, and reselection.

- **Full mapping:** show Comment and Suggest change, then the actual target in the composer.
- **Safe fragments:** retain both actions with a concise scope explanation. Suggestion fields cover
  the selected text fragments; intervening syntax stays intact.
- **No single exact comment highlight:** offer an explicitly labeled quoted-passage comment,
  attached at a verified nearby block. Retain the entire quote, not just the first fragment.
- **Existing discussion:** explain that the passage already has a discussion and offer to open it
  for a reply. Do not nest highlights.
- **Partial code:** explain that inline code is reviewed as a whole span. Offer an explicit whole-
  span selection or a comment with the exact selected quote.
- **Opaque block:** explain that inline suggestions are unavailable. Offer a quoted comment only
  when a valid adjacent attachment exists; otherwise offer Copy.
- **Generated text or unknown mapping:** say “This selection cannot be matched to the Markdown.”
  Offer Copy and retain the selection. Offer Markdown navigation only when a reliable containing
  source location exists.
- **Multiple translated blocks:** say “Select text within one translated block to comment.” Keep
  the quote copyable; do not pretend translated offsets map to original text.
- **Changed source during composition:** preserve the draft with the existing stale-target
  explanation; require a new verified target before submission.

Quoted comments are a proposal, not a shipped fallback. Settle their public in-file representation
before implementation: reuse existing quote-handling machinery where appropriate, preserve literal
quotes safely, and make attribution and attachment understandable to an agent reading the file.
A fallback must not reintroduce a private database channel. Do not attach a comment before leading
frontmatter or assume every opaque block has a legal neighboring attachment.

For mixed selections, the result must account for every visible selected segment, including parts
inside existing marks. Present an explicit choice if an action covers only some of them. A partially
mapped range is not ordinary success. Non-text objects crossed by a range also need an explicit
policy; `Range.toString()` alone cannot establish complete coverage.

## Implementation plan

1. Build a fixture matrix using the real renderer. Exercise forward/backward and element/text
   endpoints, partial/nested formatting, entities, escapes, reference/autolinks, hard/soft breaks,
   lists, tables, footnotes, images, existing marks, opaque blocks, CRLF, and translated blocks.
   Include rapid reselection and source updates so mapping failures are distinguishable from races.
2. Replace generic `empty`/`unmapped` results with selection coverage and reasoned action
   capabilities.
   Keep normal inactivity separate. Carry source revision, selected quote, mapped segments, and
   excluded segments through the toolbar; do not silently discard failed pieces.
3. Evaluate source provenance from the existing remark/micromark pipeline and maintained utilities
   before implementing another decoder. AST node offsets alone do not map characters within a
   decoded leaf. Generate that mapping once during analysis, retain it through review transforms,
   and consume it in the renderer and mapper. Compare complexity and cost before choosing a library
   or extending the existing parser integration; pin and test any adopted dependency.
4. Implement formatting-aware fragment planning on that provenance. Keep complete wrappers intact;
   split partial wrappers only at parser-identified boundaries. Preserve source spelling, escapes,
   line endings, and unselected text. Remove substring guessing when positional mapping replaces it.
5. Add the local fallback UI and the agreed quoted-comment representation. Keep comments and
   suggestions separately available. Preserve drafts through failures and focus changes; provide
   English and Chinese explanations without exposing internal parser terms.
6. Validate at both ends: review markup reparses as intended, unrelated Markdown structure stays
   intact, rejection restores original bytes, and acceptance performs exactly the proposed change.
   Test comments separately from destructive suggestions. Do not claim arbitrary replacement text
   preserves layout: a reader may intentionally change Markdown structure.
7. Verify in native WebKit with the reported selection shapes and fast interactions. Run all tests,
   both typechecks, and the desktop build before replacing the live instance. Graduate contracts
   into module docs, remove superseded fallbacks/tests, and delete this plan.

## Review points

The recommended fallback is a comment retaining the exact quote, attached at a verified block,
rather than widening the selection automatically. The representation and attachment behavior need
agreement before building it. Source-mapping improvements and explicit refusal explanations can
proceed independently of that format decision.

This is a focused selection and review-edit redesign, not a replacement Markdown editor. The audit
identifies code paths and existing checks; native boundary behavior and the expanded matrix still
need verification during implementation.
