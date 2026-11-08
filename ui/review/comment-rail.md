# Comment rail interaction

A card reads author, quoted passage, then the opening comment, followed by a reply count only when
replies exist; `RepliesDisclosure` draws that count with the chevron toggle it shares with
resolved discussions, turned while the replies show. A card without replies has no footer and no Reply
button. Clicking its passage, opening message, or count expands the discussion and focuses the reply
composer; the expanded count collapses it again and keeps focus. Enter and Space on the passage or
the card's opening-message button do the same. Repeated activation refocuses an already-open
composer. A selected card always shows its reply field, so a discussion selected without a reply
request (by Find revealing a reply, for example) offers it without taking focus. Replies appear
chronologically beneath the count. Neighboring opening messages remain fully readable. Cards use
interface typography independently of the reading font preset.

`QuotedPassage` clamps the quoted passage to two lines on an unselected card and six on the
selected card or a resolved one, ending in an ellipsis. An unselected card only clamps. On a
selected or resolved card, a passage that overflows its clamp, measured again whenever the card
resizes, offers the Full passage disclosure, which reveals it whole inside the card; a new clamp
starts collapsed. The full passage stays in the title. That disclosure and the reply count share
`DisclosureToggle`, so they look and behave alike.

`rail-layout.ts` places cards in source order without overlap. The selected card reclaims available
space above crowded anchors; earlier cards stay within the document surface. When there is not
room for every preceding card above the anchor, the selected card moves down only far enough to
retain order and separation. Measurements include actual card heights, including a resized reply
composer. Narrow comment panels use ordinary vertical flow instead of positioned cards.

Hover and keyboard focus emphasize the matching passage and card without selecting, expanding,
or repositioning either. Dragging to select text does not open a reply. Navigation reveals an
offscreen counterpart without moving one that is already visible. Wide cards share document
scrolling; narrow panels scroll their own content. The rail fades in without animating cards from
provisional positions; hiding wide comments fades it out in place, inert, before the document
recenters. Narrow panels use the same fade-in. Motion honors reduced-motion preferences.

The card remains an accessibility group, not a button containing other buttons. Its opening
message has a native button that opens the discussion and reply composer; Resolve, More, and the
reply count remain separate keyboard controls. The card has no collapse control: Escape and clicks elsewhere
collapse it. More uses the shared Radix menu behavior; its Delete comment item carries the delete
icon, as other menu items carry theirs. The composer's Cancel and Reply buttons share one compact
face, size, and height; Cancel collapses the card like Escape. The reply field resizes vertically
down to two lines. Delete comment belongs
to one message; Resolve archives the complete discussion through the existing source-splice helpers.

Escape collapses selection, as does a click anywhere but the selected card and the discussion
passages: the empty rail, margins, top bar, outline, or another card's controls. Another card's
background selects that card instead. Clicks inside menus, tooltips, dialogs, slide-over panels other
than the narrow comments panel, Find, notifications, and the selection toolbar keep it, as do a drag
and a click that ends a text selection in the document. Escape that closes a panel, popover, or menu
does not collapse it. Reply drafts stay with their discussions, including when switching or collapsing
cards. Each analysis builds its thread cards once (`threadCards` beside `group`), carrying every
member's span index; `thread-identity.ts` identifies a discussion by its anchor text and opening
message plus its start offset, which edits elsewhere shift; identical discussions are told apart by
that offset, not by their order, only while the edits are known. Review edits carry the offset
exactly; after an external change, a discussion with a duplicate is found only where the changed
region's alignments agree on its offset. Appending a reply retains the selected card. Source changes
that replace the opening message or anchor create a different card identity and clear a selection or
hover on the old one. Resolve and deleting the opening message discard that discussion's draft, and
posting the reply clears it, once the edit applies, leaving the emptied field open on the
still-selected card; a refused edit keeps the draft.

The reply textarea posts on Enter or Cmd/Ctrl+Enter, and Shift+Enter adds a line; an Enter that
cannot post inserts nothing. Composition keys, including an IME's Enter, remain with the IME. Conflict state prevents submission, deletion, and resolution while
retaining the draft; a selected card shows its reply field then only if it holds a draft or was
already open. Actions stop stale activation after a source splice.

## Resolved discussions

The history panel lists each archived discussion as a card laid out like a live one, reusing the
rail's message classes: author, the quoted passage with its left rule and six-line clamp, the
opening comment, then the shared reply-count disclosure. A record whose thread no longer parses as
comments shows its stored text instead; unrecognized records show their diagnostic and raw text. Cards
offer no jump to the passage, since resolution removes its anchor. The opening message carries the
live card's More menu, whose Delete discussion removes the record through `deleteResolvedThreadEdits`
and the document's review-edit path, so undo, saving, and paused editing behave as for live cards;
paused editing disables the item. Unrecognized records offer no deletion.
