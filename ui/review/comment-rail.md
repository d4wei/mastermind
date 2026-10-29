# Comment rail interaction

A collapsed card shows its quoted passage, opening message, and a reply count. Clicking its passage,
opening message, or count expands the discussion and focuses the reply composer. Enter and Space on
the passage or the card's opening-message button do the same. Repeated activation refocuses an
already-open composer. Replies appear chronologically beneath the quoted passage. Neighboring
opening messages remain fully readable. Cards use interface typography independently of the reading
font
preset.

`rail-layout.ts` places cards in source order without overlap. The selected card reclaims available
space above crowded anchors; earlier cards stay within the document surface. When there is not
room for every preceding card above the anchor, the selected card moves down only far enough to
retain order and separation. Measurements include actual card heights, including a resized reply
composer. Narrow comment panels use ordinary vertical flow instead of positioned cards.

Hover and keyboard focus emphasize the matching passage and card without selecting, expanding,
or repositioning either. Dragging to select text does not open a reply. Navigation reveals an
offscreen counterpart without moving one that is already visible. Wide cards share document
scrolling; narrow panels scroll their own content. The rail fades in without animating cards from
provisional positions. Narrow
panels use the same fade. Motion honors reduced-motion preferences.

The card remains an accessibility group, not a button containing other buttons. Its opening
message has a native button that opens the discussion and reply composer; Resolve, Collapse
discussion, More, and Reply remain separate keyboard controls. More uses the shared Radix menu
behavior. Delete comment belongs to one message; Resolve archives the complete discussion through
the existing source-splice helpers.

Escape and clicks elsewhere in the article collapse selection; Escape that closes a panel, popover,
or menu does not. Reply drafts stay with their discussions, including when switching or collapsing
cards. Each analysis builds its thread cards once (`threadCards` beside `group`), carrying every
member's span index; `thread-identity.ts` identifies a discussion by its anchor text and opening
message plus its start offset, which edits elsewhere shift; identical discussions are told apart by
that offset, not by their order, only while the edits are known. Review edits carry the offset
exactly; after an external change, a discussion with a duplicate is found only where the changed
region's alignments agree on its offset. Appending a reply retains the selected card. Source changes
that replace the opening message or anchor create a different card identity and clear a selection or
hover on the old one. Resolve and deleting the opening message discard that discussion's draft, and
posting the reply clears it, once the edit applies; a refused edit keeps the draft.

The reply textarea retains normal text-input semantics and its submission shortcut. Composition
keys remain with the IME. Conflict state prevents submission, deletion, and resolution while
retaining the draft. Actions stop stale activation after a source splice.
