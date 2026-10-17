---
status: living
updated: 2026-10-17
exit: Adopt the reviewed interactions, graduate their contracts and tests, then delete this design.
---

# Review states, recovery, and visual feedback

This is a proposed design, grounded in the current implementation. It covers the document lifecycle,
review drafts, recovery, application exit, and the visual changes reported during use. The exit
policy is settled in DECISIONS.md; retiring merge below is a recommendation awaiting a ruling.
The remaining design is proposed. The file remains the authority;
no hidden recovery store, automatic overwrite, or background translation service is introduced.

## Findings

- Sepia maps hover to `gray-3`, whose OKLCH lightness is 0.944, identical to its page background.
  The slight hue change cannot carry a dependable hover affordance.
- The comment grid below 1180 px gives the left gutter 0.2 fractions and the right gutter one full
  fraction. Cards also have a capped width, leaving unused space beyond them. The result can move
  the document farther left than the cards require.
- Top-right controls use muted text on a transparent background. Open uses normal text, an elevated
  surface, and a border. Their dimensions alone do not give them equal visual weight.
- Sepia comments use `#345fc0` for both passage underlines and active card outlines. This is a
  separate review token, not the theme's ochre accent. The other six palettes also need review as
  complete sets of semantic colors, not isolated swatches.
- Conflict recovery currently presents four simultaneous actions. Dismissal replaces them with a
  full-width notification. Native close and quit failures instead render text in the file toolbar.
  These surfaces have separate ownership and do not form one recovery interaction.
- A conflict blocks both closing its file and quitting. There is no explicit discard-and-leave path.
  A temporary inability to read the file also becomes a conflict; a later successful read of the
  unchanged disk version previously cleared the detail but left the conflict set. Regression tests
  now reproduce that trap; the accompanying fix clears the read failure and resumes pending saves.
- The reported comment-triggered warning is intermittent. One native selection/comment submission
  on a disposable file saved correctly and remained editable after watcher revalidation. This does
  not identify or clear the original report. Do not modify a real review file to reproduce it.

Evidence: [document state](../ui/documents/store.ts),
[native adapter](../ui/desktop/NativeReviewer.tsx),
[conflict UI](../ui/app/ConflictPanel.tsx), [notifications](../ui/app/Notifications.tsx),
[layout](../ui/app/app.css), and [theme tokens](../themes/README.md).

## Interaction rules

1. Ordinary review should stay quiet. Saving a comment is an ordinary edit and must not itself
   imply that another writer changed the file.
2. Name the actual condition: unsaved edits, saving, file changed, file unavailable, or save failed.
   Do not call every I/O failure a conflicting version.
3. Preserve local edits until the person saves, adopts another version, or explicitly discards them.
   Closing is always reachable. Protection must offer a decision rather than merely refuse exit.
4. Dismissing a notice changes its presentation only. It does not authorize losing edits, unblock
   an unsafe write, or pretend a conflict was resolved.
5. Pause writes only for the affected file. Reading, copying, other files, and recovery stay usable.
6. Each condition has one notification identity. Retrying updates that notice; it does not stack
   duplicates. A new underlying condition may update its text without repeatedly grabbing focus.

## State inventory

Use independent axes rather than a boolean for every combination. The tables enumerate the states
and events within this scope; their precedence rules govern combinations.

### Application and opening

| State | Available action | Next state |
| --- | --- | --- |
| Loading settings | Retry on failure; quit | Setup, home, or document |
| Setup incomplete | Edit and confirm; quit without confirming | Ready after saved confirmation |
| Home | Open Markdown files; quit | Picker or opening |
| Picker open | Choose files; cancel | Opening, or unchanged prior screen |
| Opening | Existing files remain usable | Admitted files or opening errors |
| Partial admission | Read successes; inspect failures; dismiss | Existing review continues |
| Document loading | Switch file; close; retry failed read | Ready or unavailable |
| Load failed, no buffer | Retry; close file | Ready or closed |
| Ready | Read, review, switch, close | Per-document states below |
| Closing requested | Save or offer recovery choices | Closed, cancelled, or recovery |
| Quit requested | Check all files and drafts together | Exited, cancelled, or recovery |

Opening the same canonical path selects the existing file. It does not replace a dirty buffer.
Opening errors belong to the bottom-left notification area, including failures before any document
is available. Settings failures use that same area; field validation remains beside its field.

### Document persistence

| State | Meaning | Editing / autosave |
| --- | --- | --- |
| Saved | Buffer matches acknowledged disk contents | Enabled / idle |
| Unsaved | Accepted edits differ from saved base | Enabled / scheduled |
| Saving | One write is in flight | Enabled / serialize subsequent edits |
| Checking disk | A watcher or focus event requires a fresh read | Retain current state |
| Save failed | Write failed; disk outcome may be uncertain | Retain edits; recheck before retry |
| Unavailable | A read failed; cause may be temporary | Retain text; pause writes pending check |
| Missing | Fresh evidence confirms the path is absent | Retain text; never recreate silently |
| Conflict | Verified incoming version differs with local edits | Pause affected-file mutation |
| Recovering | Adoption or copy is in flight | Pause affected-file mutation |

A watcher event is a hint, not a conflict. A metadata-only difference is not proof of a text change.
The implementation must retain the native identity/version guard even if a fresh read permits
rebasing unchanged content. Identical replacement files need an explicit reconciliation policy;
never suppress all watcher events during saving.

### Reconciliation and recovery transitions

| Event | Outcome |
| --- | --- |
| Edit or submitted comment | Unsaved; schedule autosave |
| Save succeeds, no newer edits | Saved; acknowledge returned version |
| Save succeeds, newer edits exist | Unsaved; save the remainder against the new version |
| Own write invalidation | Verify acknowledged version; no warning |
| Older read completes after newer operation | Ignore obsolete result |
| External change, no local edits | Reload; preserve reading position where possible |
| External change, local edits | Conflict; retain base, local, and incoming versions |
| Read fails | Unavailable; no assertion that contents changed |
| Retry reads the unchanged base | Clear verification failure; resume pending save |
| Retry reads different contents with local edits | Conflict |
| Disk now equals current buffer | Reconcile as saved after a fresh guarded read |
| Disk again changes during recovery | Retain local text; update recovery choices |
| Use incoming confirmed | Adopt fresh contents; resume editing |
| Copy picker cancelled | Keep buffer and original state |
| Copy succeeds | Select admitted copy; release original buffer |
| Copy or clipboard fails | Keep buffer; explain that operation's failure |
| Path reappears | Recheck; classify contents rather than retaining stale missing state |

Read, write, and recovery completions belong to their originating file even after navigation.
A successful check clears its own stale error and pending-close warning. A failed check must not
clobber a newer successful save. Same-content rebasing must preserve original bytes and line
endings.

### Review and panel states

| State / event | Required behavior |
| --- | --- |
| Nothing selected | No selection actions |
| Passage selected | Comment and Suggest change available |
| Composer empty | Cancel freely; submit disabled |
| Composer has draft | Keep text through panel changes and temporary file unavailability |
| Comment submitted | Exact source edit; ordinary autosave; focus returns to discussion |
| Suggestion unchanged | No edit; empty replacement means deletion |
| Discussion collapsed / expanded | Keep replies readable and unfinished reply drafts retained |
| Resolve / delete / accept / reject | Source edit and undo; no separate persistence path |
| Conflict during composition | Keep draft; pause submit; reading and recovery remain usable |
| Translation missing / stale / failed | Original remains available; no opening gate |
| Translation changes during draft | Retain draft and quote; revalidate its source anchor |
| File navigation with draft | Retain draft by document; never attach it to another file |
| Close with nonempty draft | Explicit draft-discard choice; never silently submit it |
| Settings saving / failed | Own status; do not mislabel as document failure |
| Find, Settings, Resolved, narrow Comments | One main overlay at a time; recovery stays reachable |

Unsubmitted comment/reply text is not in the Markdown buffer. Saving a document copy does not save
those drafts. A close decision must disclose and handle them separately. Their retention across
file switches is part of this design, not a claim that the current component-local state does it.

## Does this reviewer need three-way merge?

**Recommendation under review:** remove the merge operation and use preservation plus explicit
version choice for genuine conflicts. The existing merge ruling and implementation remain in
force until superseded; this assessment does not authorize their removal by itself.

Autosave reduces how often local edits remain unwritten while an external update arrives. It does
not eliminate concurrent writing. The current store resets its debounce on each edit, so continuous
source editing can keep a buffer dirty longer than one debounce interval. An in-flight write,
unreadable file, permission failure, or missing destination can also extend that interval. Conflict
frequency has not been measured; calling every remaining collision rare would exceed the evidence.

The ordinary path is already simple: save accepted edits; reload external changes when no accepted
local edits are pending. A conflict needs protection only when the app has pending local edits and
cannot safely write them against the disk version. That protection requires retaining text and
checking versions, not a merge algorithm.

The strongest case for keeping merge is simultaneous source editing by a person and an agent on
different parts of a document. A clean merge can combine those changes in one step without a copy.
Removing it makes that case less convenient: preserve a separate file and reconcile deliberately,
using an agent or editor chosen by the person. Merely creating the copy does not reconcile it.
This is the concrete tradeoff, not a claim that autosave makes merging mathematically redundant.

There is a different risk that the current merge feature does not address. An agent can read an
old file, compute an edit, and overwrite newer, already-autosaved review marks later. The reviewer
then has no pending local edits and reloads the incoming version. Its existing merge operation is
never offered. Preventing stale external overwrites requires cooperation from that writer, or a
separate revision-history/concurrency policy; keeping this merge button does not provide it.

Prefer the smaller reviewer model unless concurrent independent editing becomes a demonstrated
primary workflow. Genuine conflicts expose **Save As…** and **Use incoming** directly. Missing or
unavailable destinations expose **Save As…** and **Retry**. The generic recovery menu is no longer
needed. A successful read showing unchanged bytes can be reconciled without merging content, while
retaining file-identity and write-version checks.

Removing merge would delete its UI action, store write-recovery branch, overlap/limit states,
`document/merge.ts` and its sidecar, merge-only tests, the `node-diff3` dependency, and its explicit
license-packaging entry. Update translated labels and canonical terminology with that removal.
Keep tests for read/write races, source preservation, copy failure, incoming adoption, and close.
The saved snapshot is still needed to distinguish pending edits and preserve exact source; removing
merge does not justify deleting it or weakening the native write guard.

The remaining model is: saved, save pending/in flight, unable to save or verify, and conflicting
versions. Composer drafts are a separate axis. There is no merge candidate, merge overlap, merge
limit, or merged-write recovery state. Closing continues to flush and only asks when preservation
fails or a meaningful unsubmitted draft remains.

## Recovery choices by cause

Action rankings below are design judgments about the likely intent, not measured usage frequencies.
The common objective is to preserve accepted review work and continue. Choosing a different version
is a distinct intent and must not be disguised as retrying a failed operation.

| Situation | Likely intent | Useful actions, in priority order |
| --- | --- | --- |
| Pending or in-flight autosave | Keep reviewing, or finish closing | Wait; no decision yet |
| External change, no local edits | Read the latest version | Reload automatically; no decision |
| Temporary read failure, local edits | Resume against a verified file | Retry; Save As… |
| Missing file, local edits | Preserve the work somewhere accessible | Save As…; Retry |
| Write failure, original readable | Get accepted edits onto disk | Save As…; Retry |
| Both versions changed | Preserve local work, or adopt incoming | Save As…; Use incoming |
| Another change during recovery | Act on current evidence | Recheck, then show the relevant pair |
| Copy fails or is cancelled | Preserve the buffer | Stay in the same recovery state |

**Retry** makes sense for temporary unavailability. It is less promising when evidence identifies a
persistent permission or destination problem. If there are no local edits or drafts, unavailability
needs Retry and an ordinary close path, not a warning about work that does not exist.

**Save As…** is the broadly useful preservation route: it does not require combining versions or
being able to read the original. It can still fail, and it saves accepted document edits rather than
unsubmitted composer drafts. It must not bypass the original file's version guard by selecting the
same destination. Existing destinations require the usual overwrite safeguards. Claim success only
after the copy has actually been saved.

**Use incoming** is useful when the local work is expendable or superseded. It is not equivalent to
saving or copying. It remains directly reachable in the proposed two-action notice. Confirmation
must state that local accepted edits will be replaced. No force-overwrite-original action is added.

**Copy my version** does not deserve a permanent recovery slot. It does not complete persistence or
restore editing, and clipboard contents are easy to replace. Keep ordinary text copying available.

### One surface, direct actions

Use the bottom-left notification host for background document and application failures. Present
the relevant actions directly. Remove Review options and do not open a recovery box above another
notice. Changing condition, confirming replacement, or reporting a failed attempt updates the same
surface. A native save picker temporarily replaces the custom recovery interaction; cancelling it
returns to that interaction. Do not leave multiple custom cards layered beneath the picker.

Use at most two decision controls. Temporary read/write failures need Retry and Save As; a
content conflict needs Save As and Use incoming. Dismissal collapses the surface into the small
warning icon without clearing its state. File pills retain a warning indicator. A new operation
updates the existing notice and does not stack another one or repeatedly seize focus.

If the merge retirement recommendation is adopted, both meaningful conflict actions fit directly
on the notice: Save As and Use incoming. No action menu is needed to meet the control budget.

No generic menu is needed for states with only two useful choices. A dismissed notification's
warning icon restores the same surface directly. Repeated events update it without reopening it.
Opening a close-confirmation sheet hides the background recovery notice until that decision ends.

## Closing in an autosaving editor

There is no ordinary Save changes or Save All terminal screen. Accepted source edits and submitted
review marks already schedule autosave. The current store debounces writes and explicitly flushes
on close: an unsaved interval is a normal internal state, not ordinarily a user decision.

1. If there is a meaningful unsubmitted draft, handle that draft first as described below.
2. Flush pending accepted edits and await the current write. If they save, close silently.
3. If saving fails or a verified conflict blocks it, show the exceptional close decision.
4. Cancel aborts the close request. Saving or explicitly discarding completes only its named scope.

| Close condition | Interaction |
| --- | --- |
| Saved, no draft | Close silently; a stale warning alone cannot block close |
| Pending autosave | Flush; close on success without asking whether to save |
| Saving | Await completion; coalesce repeated requests; allow cancellation |
| Save failed or blocked by conflict | Save As… / Don't Save / Cancel |
| Copy succeeds during close | Complete close; do not open a replacement tab |
| Copy fails | Retain edits and explain the failure in the same close surface |
| Copy picker cancelled | Restore the close surface without discarding anything |
| Don't Save | Close, discarding only the named unsaved work; no second confirmation |
| Cancel or Escape | Cancel close and return to the relevant document or composer |
| Native close fails | Report separately without mislabelling document state |

Only the failed/blocked-save close sheet gets three decision actions, per the explicit exception.
It follows familiar editor ordering and keyboard behavior. Don't Save is never the default action,
does not undo completed autosaves, and does not claim to cancel a write already dispatched.

Quitting flushes every open file first. If all save and no drafts remain, quit silently regardless
of file count. If some cannot save, name only those remaining files in one close sheet. Offer to
save copies, quit without saving them, or cancel. A successful copy removes its file from that
list. A cancelled picker or failed copy retains the remaining work. A changed set of unsaved files
cannot inherit an earlier discard decision. Do not invent a routine Save All screen.

Apple's [document close contract][apple-close] describes the exceptional save/not-save/cancel
choice. VS Code's [Hot Exit][vscode-exit] retains unsaved buffers across launches; that separate
session-restoration feature remains deferred here. Familiar dismissal must not imply such storage.

[apple-close]: https://developer.apple.com/documentation/appkit/nsdocument/canclose(withdelegate:shouldclose:contextinfo:)
[vscode-exit]: https://code.visualstudio.com/docs/editing/codebasics#_hot-exit

### Return to the existing draft

Drafts belong to their original comment, reply, or suggestion composer. Never create another text
field or a read-only duplicate inside a close dialog. Empty untouched composers do not block close;
a changed suggested replacement is meaningful even if its new text is empty, meaning deletion.

A close request with a meaningful draft offers **Cancel** and **Discard draft**. Cancel ends the
close/quit request, selects the owning document, reveals its original composer, scrolls it into
view, and restores focus and selection. It does not merely dismiss the dialog. Submission remains
a deliberate action in that composer. A conflict may still prevent submitting, but draft text and
focus must be retained while recovery remains available.

Discard draft discards the identified draft and continues the original close request. Accepted
edits still follow the autosave/failed-save sequence above. With several drafts, name their owning
files and composers in a compact list; Cancel focuses the first unfinished composer, while an
explicit plural discard applies only to the listed drafts. No draft is silently posted or treated
as preserved by saving a Markdown copy.

A native write that never completes remains a separate implementation question. Cancelling close
must remain available. A timeout cannot imply rollback or make Don't Save claim to cancel an
already dispatched write. Validate host termination behavior before adding a force-exit control.

## Comment layout and movement

Use the document width, fixed card width, gap, outline strip, and viewport as layout inputs. The
outline occupies visual space on the left even though it is narrow. Center the reading group in
the space remaining to its right, rather than treating that strip as empty margin. This produces a
smaller outer gap on the right than on the left and should be compared at several window widths.
The correction applies only while the outline is visible, including its absence in source view.
Do not move the document when the outline expands on hover; its popup overlays the reserved strip.

- If the right margin fits the cards and their gap, keep the document at its no-comments position.
- Otherwise, center the document-plus-comments group in the remaining reading area. Allocate
  only the rail width that cards use, rather than a whole flexible column beyond a capped card.
- If the combined group cannot fit while keeping a readable document width, use the Comments panel.
  Large text and user-selected text widths participate in this calculation.
- Animate only the necessary horizontal relocation on adding/removing the rail, around 180 ms.
  Use measured old/new positions; avoid interpolating text width through continuous reflow. Keep
  the active passage at its scroll position and remeasure card anchors after the layout settles.
- Reduced motion changes position immediately. Resizing must not accumulate running animations.
  A selected passage, composer, and comment card must remain attached throughout the transition.

## Theme and control audit

Preserve semantic roles across all seven themes. Theme accent belongs to application actions;
insertion, deletion, comments, and warnings keep separate meanings and shape/text cues. A palette
may vary the hues without turning every selected item into the accent color.

| Theme | Current comment color | Proposed direction |
| --- | --- | --- |
| Grid | Blue | Retain restrained blue; compare against red application accent |
| Sepia | Saturated blue | Warm muted ochre/brown, distinct from deletion and warning |
| Rose | Blue | Muted plum; distinguish from rose accent and deletion |
| Cobalt | Violet | Retain violet; check separation from blue application accent |
| Nacht | Violet | Retain palette-compatible violet; check on both dark surfaces |
| Slate | Violet | Reduce saturation if it dominates; retain semantic separation |
| Carbon | Pale violet | Check brightness and contrast against neutral chrome |

These are palette directions for a rendered comparison, not approved hex values. Review insertion,
deletion, comment underline, active card, hover fill, selection, focus, warning, and code colors
in the same specimen. Check ordinary, hovered, pressed, selected, disabled, and focused controls
against both page and elevated surfaces. Verify neutral hover is visible in every theme and remains
distinct from pressed and selected states. Film grain cannot be what makes a control visible.

Normalize controls at three separate levels: hit area, icon geometry, and interaction state. Use
one outline icon family, a shared stroke weight, and equal optical bounds; enclosed shapes may need
a slightly smaller footprint than open shapes. Equal nominal SVG dimensions alone are insufficient.
Use the same quiet button surface and border for Open, Source, Comments, and More. Keep the same
comment glyph in both states; indicate selection with a restrained surface change rather than a
heavier border plus stronger fill plus darker glyph. Check the whole row in normal, hover, selected,
and keyboard-focus states in every theme. Exact optical adjustments remain a visual decision.

## Implementation sequence and acceptance

1. Address reproducible persistence defects with failing regression tests first. Keep the
   intermittent native comment report open until its trigger is identified or measured.
2. Settle merge retirement, apply the exit policy, and review the notification hierarchy, then
   implement lifecycle transitions before polishing recovery controls. Use the existing native host,
   Radix popovers/menus, and shared notification area; no new UI framework is needed.
3. Preview one complete recovery interaction, including dismissed and close/quit states. Review a
   full theme specimen and wide/constrained comment layouts before selecting final palette values.
4. Implement the layout, control, and theme changes. Graduate this design into module contracts,
   transition tests, and manual native checks, then delete it.

Verification covers every transition table row, plus these concurrency and composition cases:

- Watcher events before/during/after a save; read failures; same-version recovery; genuine changes;
  identical-content replacements; file disappearance and return; another write during recovery.
- New edits during save; repeated recovery/close/quit; navigation during reads and copies;
  late completions after close; cancellation of a picker; failed native close; slow I/O.
- Several dirty/conflicted files; close one versus quit all; a draft without a submitted edit;
  draft plus conflict; setup confirmation plus quit; preference failure plus document failure.
- Narrow/wide windows, changed text width and font size, long Chinese labels, crowded comments,
  keyboard-only operation, reduced motion, and focus restoration after every popover or dismissal.
- Every theme on page and elevated surfaces, including selected-plus-hovered and disabled controls.

Unit and host tests cover deterministic state transitions. Native dogfooding checks real watcher,
picker, focus, IME, and close behavior. Passing injected tests does not establish those platform
behaviors or resolve the intermittent report by itself.
