# Comment rail interaction

A card reads author, quoted passage, then the opening comment, followed by a reply count only when
replies exist; `RepliesDisclosure` draws that count with the chevron toggle it shares with
resolved discussions, turned while the replies show. A card without replies has no footer and no Reply
button. Clicking its passage, opening message, or count expands the discussion and focuses the reply
composer; the expanded count collapses it again and keeps focus. Enter and Space on the card's
opening-message button do the same. Repeated activation refocuses an already-open composer. A
selected card always shows its reply field, so a discussion selected without a reply request (by
Find revealing a reply, for example) offers it without taking focus. Replies appear chronologically
beneath the count: every reply when there are three or fewer; otherwise a row reading how many
earlier replies there are, drawn with the count's `DisclosureToggle`, then the last two. Activating
that row shows every reply, moving focus to them, until the card is deselected; Find revealing a
reply the row hides does the same. Neighboring opening messages remain fully readable. Cards use
interface typography independently of the reading font preset.

`QuotedPassage` clamps a live card's quoted passage to two lines whether or not the card is
selected, and a resolved card's to six, ending in an ellipsis. Overflow is measured again whenever
the passage resizes and once a clamp change finishes easing. On the selected live card, a passage
that overflows its clamp is a control (`role="button"`, `aria-expanded`, labeled Show more with the
passage): clicking it, or Enter or Space, reveals it whole, growing downward, until the card is
deselected; there is no collapse control and no disclosure row. Any other live passage is no
control, and a click on it reaches the card. On a resolved card, a passage that overflows offers
Show more beneath it, which reveals it whole and then reads Show less. That disclosure and the reply
count share `DisclosureToggle`: the reply count's chevron turns from right to down as replies appear
below, and the passage's turns from down to up as it grows in place.

`rail-layout.ts` places cards in source order without overlap, around one pivot, so that cards move
as little as they can. Every card wants its opening message's body level with the top of its
passage: its aligned top is the passage's top less its body offset, the distance from the card's
top to that body, never above the rail's top. The pivot is the card most recently selected; it stays
the pivot after deselection, so it stays where it is, and changes only when another card is
selected or its discussion leaves the cards. Without a pivot, each card takes its aligned top or
sits one gap below the card before it, whichever is lower. The pivot takes its aligned top unless
the cards before it would not fit above it within the rail, and then moves down only as far as they
need; earlier cards stack upward from it, each as close to its aligned top as order allows, and
later cards stack downward. Nothing above a card's body line changes height on selection, so a
selected card keeps its top and grows downward only, later cards move down as it grows and come back
as it shrinks, and no position is remembered beyond the pivot. A card keeps the body offset its
clamped passage gives while that passage is expanded or easing back. When cards run past the
document's end, the rail leaves the space the document column leaves below the body, read from the
rail's bottom padding. Every card is placed, whether or not it is mounted: a mounted card by its
measured height and body offset, including a resized reply composer; an unmounted one by those it
was last measured at, or by estimates if it has never rendered. Narrow comment panels use ordinary
vertical flow instead of positioned cards.

In the wide rail, only the cards whose placed box meets the viewport, plus one and a half viewports
above and below, are mounted. The rail also keeps mounted the selected card (which is how a
navigation that reveals a card, such as Find into a comment, clicking an anchor, or selecting a
discussion, brings it in), the card with keyboard focus, the card with an open or requested
composer, and every card holding a draft. Everything else is unmounted, and the rail keeps its full
placed height, so the scroll extent stays right. The narrow panel flows in its own scroller and
mounts every card. Scrolling recomputes the window once per frame and renders entering cards before
that frame paints; a card mounts at its placed `top` and is measured and re-placed before paint.

A remembered height is dropped when the card's content (its messages, their authors and bodies, or
its passage) changes, when the card gains or loses the selection, or when the rail's width changes;
a card that unmounts while a section is still closing is remembered at the height it settles to.
Font and interface-language changes are not detected, so remembered heights can be stale until the
card next mounts and is measured. Estimates are computed from content: the author row, the passage
at its two-line clamp (or the smaller gap of a card without one), the opening message's wrapped
lines, and the reply count; the body offset is the same geometry down to the opening message's
body. Their geometry is read once from the first rendered single-message card with a passage, and
heights and body offsets are each scaled by the ratio of measured to estimated values over the
unselected cards measured so far. An estimate that is off moves cards once the card mounts and is
measured, which shows mainly while scrolling up through an unvisited part of a crowded rail; the
article itself never moves.

Tab order follows the DOM, so an unmounted card would be skipped. The rail therefore keeps the
focused card's neighbors in source order mounted as well: when focus reaches the first or last
mounted card, the adjacent discussion beyond it mounts, and the next Tab or Shift+Tab lands on it.
Find counts comment results from the analysis, so its counter covers every card, but it paints a
comment match only while its card is mounted; revealing a result in an unmounted card selects the
discussion, which mounts the card, and the match then paints and scrolls into view. When a typed
query chooses the first result at or after the reading position, an unmounted card's comment
counts by its passage's position. Cards mounting as the window moves repaint Find without
discarding the article's indexed text or searching the comments again (`ReadingIndex` in
`ui/find/reading.ts`).

Each mounted card is a memoized `RailCard` that receives only its own selection, emphasis,
placement, composer, and draft state, with the rail's actions in one object that lives as long as
the rail, so hover, focus, selection, or typing renders only the cards whose state changed, and a
window change renders only the cards entering it. The document view keeps its analysis and
rendering context stable across those changes, so it does not render at all;
`tests/session-render-scope.test.tsx` checks both.

Hover and keyboard focus emphasize the matching passage and card without selecting, expanding,
or repositioning either. They are separate sources, and either one emphasizes: the pointer leaving
a card or passage ends only hover, and focus leaving a card ends only focus, so a focused card stays
lit while the pointer crosses other cards and passages, and pressing another card's body keeps its
passage lit until the click selects it. Dragging to select text does not open a reply. Navigation
reveals an offscreen counterpart, mounting a card first, without moving one that is already
visible. Wide cards share document scrolling; narrow panels scroll their own content. The rail
fades in without animating cards from provisional positions; hiding wide comments fades it out in
place, inert, before the document recenters. Narrow panels use the same fade-in. Motion honors
reduced-motion preferences.

Sections that appear inside a card, live or resolved, ease open and closed through `Collapsible`:
the reply composer and its alert, the replies and the earlier-replies row, and a resolved passage's
Show more row. Its grid row moves
between `0fr` and `1fr`, so the card's height follows its content and is never set. Closing content
keeps its last open render and stays mounted, inert, hidden from assistive technology and refusing
input, until the row's transition ends or is cancelled; a collapsing composer neither posts nor
shows another card's verdict, and reopening it mid-collapse renders the same field live and focuses
it. A moving section clips with `overflow: clip`, because focusing a field inside an
`overflow: hidden` clip scrolls the clip and throws its content toward the top; clipping ends when
the row's transition ends or is cancelled, but not when a reversal cancels it while the row still
moves. The quoted passage eases between clamps
by animating `max-height` from the height on screen to the next clamp's measured height, and a
shrinking clamp stays drawn until then, so the ellipsis appears only at the final height. The rail
re-places cards synchronously from its size observer, so neighbors follow an easing card in the
same frame unless a selection is easing it (below), and a card not yet placed stays unseen rather
than at the rail's top. One observer
watches the document and every mounted card for the rail's lifetime (`RailPlacement` in
`rail-layout.ts`); an observation re-reads only the cards it reports, and anchor offsets only when
the document resized, and writes positions to the cards without rendering them. Anchor offsets are
read for every card, mounted or not. A new selection or set of cards measures every mounted card
once, and a commit that mounts cards measures those before paint. Easing sections mark the size
they settle to (`settling.ts`): a shrinking one its final height, an opening one its content's full
height. Earlier cards make room for the pivot only by the heights they keep, so a card collapsing
above it never rises for height it is losing.

A selection change is one motion on one clock. The card it reaches and the card it leaves are
placed by the heights their sections settle at, from the commit that changes the selection until
each measures at that height, so placement holds still while they ease and the size observer
re-aims nothing. Each mounted card whose place changes keeps its new `top` at once, so layout and
the window stay exact, while a transform plays from where the card was drawn, an interrupted move
included, back to zero, started in that commit, over `--rail-card-move` and `--ease-standard`. The
theme sets `--rail-card-move` to `--dur-base`, the sections' own duration, so a card pushed by an
opening section travels with the edge that pushes it. A move under a pixel happens at once, and a
card mounting in that commit has nowhere it was drawn and appears in place. Re-placements with no
selection change (from the size observer, as a reply field grows; from anchors moving with the
document; from a new set of cards; from cards mounting as the window moves; from an estimate meeting
its first measurement) move at once: they follow motion that is already frame by frame, or correct
a card nobody watched settle. Revealing a selected card reveals where it is placed, not where its
move still draws it. Reduced motion sets the move duration to zero.

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
background selects that card instead. Cards, discussion passages, and deletion marks keep the
selection by carrying `data-keeps-discussion` where they are defined; floating layers, such as
menus, tooltips, dialogs, slide-over panels, Find, notifications, and the selection toolbar, keep it
without a mark, under the [outside-press rule](../util/outside-press.md). The narrow comments panel
hosts the rail, so a click on its empty space deselects. A drag and a click that ends a text
selection in the document keep it too. Escape that closes a panel, popover, or menu
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
cannot post inserts nothing. Reply follows the [block-scope verdict](../modes/reading/selection.md#verifying-marks)
of the deferred draft; posting verifies the whole document, and its refusal disables Reply until the
text or source changes. Composition keys, including an IME's Enter, remain with the IME. Conflict state prevents submission, deletion, and resolution while
retaining the draft; a selected card shows its reply field then only if it holds a draft or was
already open. Actions stop stale activation after a source splice.

## Resolved discussions

The history panel lists each archived discussion as a card laid out like a live one, reusing the
rail's message classes: author, the quoted passage with its left rule and six-line clamp, the
opening comment, then the shared reply-count disclosure. The panel reads the records from the
view's plain parse of the current source when it holds one, and parses the source itself once per
source otherwise. A record whose thread no longer parses as
comments shows its stored text instead; unrecognized records show their diagnostic and raw text. Cards
offer no jump to the passage, since resolution removes its anchor. A card is keyed by its quoted
passage and discussion, with its offset only beside an identical record, so deleting a record
never hands its state, such as expanded replies, to the record after it. The opening message carries the
live card's More menu (`DiscussionMenu`), whose Delete discussion removes the record through `deleteResolvedThreadEdits`
and the document's review-edit path, so undo, saving, and paused editing behave as for live cards;
paused editing disables the item. Unrecognized records offer no deletion.
