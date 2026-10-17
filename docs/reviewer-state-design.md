---
status: living
updated: 2026-10-17
exit: Adopt the reviewed interactions, graduate their contracts and tests, then delete this design.
---

# Review states, recovery, and visual feedback

This is a proposed design, grounded in the current implementation. It covers the document lifecycle,
review drafts, recovery, application exit, and the visual changes reported during use. The exit
policy is settled in DECISIONS.md; the remaining design is proposed. The file remains the authority;
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
| Recovering | Merge, adoption, or copy is in flight | Pause affected-file mutation |

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
| Try merge succeeds | Save immediately against freshly read version; resume editing |
| Try merge overlaps or exceeds limits | Write nothing; offer copy or incoming version |
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

## Notifications and recovery controls

Use one bottom-left notification host for document and application events. Move native opening
and setup-loading failures into it. Close decisions use the save-changes dialog below. Keep field
validation local. Find retains the top-center slot. No error text should displace toolbar controls.

A new conflict notice names the file and states the consequence in one sentence:
“Edits paused: this file also changed on disk.” Its primary action is **Review options**. That opens
a compact recovery popover at the notification area, not another full-screen comparison tool.

The recovery popover uses one primary action and a labelled alternatives menu:

- When a merge is possible: **Try merge**; alternatives **Use incoming…**, **Save my version as…**,
  and **Copy my version**.
- After an overlapping merge: **Save my version as…**; **Use incoming…** stays available. Explain
  the overlap without showing a four-button row or repeating a failed recommendation.
- For unavailable or missing files: **Retry**; copy and clipboard remain alternatives. Do not offer
  a merge or adoption until incoming contents are readable.
- While an operation is pending: show its operation name, prevent duplicate requests, and retain
  navigation and a way to cancel the broader close request. Cancelling a native picker is safe;
  cancelling a screen cannot imply cancellation of a filesystem write already underway.

Dismissing the expanded notice leaves one small warning-icon button in the notification corner,
with an issue count only when more than one file needs attention. Its tooltip and accessible name
identify the condition; clicking opens the list or the single affected file's recovery popover.
File pills retain their own small warning icon for direct navigation. Do not repeat a permanent
“filename · Needs attention” banner. No pulsing, color-only meaning, or repeated alert announcement.
Dismissal and successful resolution restore focus to the invoking control.

## Closing follows editor conventions

Use the familiar save-changes dialog, with **Save**, **Don't Save**, and **Cancel**, when closing
would lose unsaved edits. The dialog itself is the confirmation. Do not hide Don't Save in an
alternatives menu or follow it with another confirmation. A clean document closes silently;
autosave normally makes this the common case.

Apple's [document close contract][apple-close] explicitly offers saving, not saving, or cancelling.
VS Code also supports [Hot Exit][vscode-exit], retaining unsaved buffers for a later launch. That
requires persisted session recovery, which this project still defers; do not imply that discarded
text will return. These are distinct editor behaviors, not interchangeable implementations.

[apple-close]: https://developer.apple.com/documentation/appkit/nsdocument/canclose(withdelegate:shouldclose:contextinfo:)
[vscode-exit]: https://code.visualstudio.com/docs/editing/codebasics#_hot-exit

| Close condition | Interaction |
| --- | --- |
| Saved, no draft | Close silently; a stale warning alone cannot block close |
| Pending autosave | Flush once; close on success |
| Saving | Coalesce requests; allow cancellation of the close request |
| Unsaved after failure | Save / Don't Save / Cancel dialog naming the file |
| Conflict prevents safe save | Save As… / Don't Save / Cancel; explain the external change |
| Copy succeeds during close | Complete close; do not open a replacement tab |
| Save or copy fails | Retain edits and dialog; show failure beside the attempted action |
| Save picker cancelled | Return to close dialog without discarding anything |
| Don't Save | Close immediately, discarding only the named unsaved work |
| Cancel or Escape | Cancel close and restore focus; keep edits and recovery available |
| Native close fails | Report separately without mislabelling document state |

The save-changes dialog is a focused, accessible modal sheet, following platform button ordering
and keyboard behavior. Background conflict and save-error notices stay in the bottom-left area;
a deliberate close request gets the customary decision dialog. Don't Save is never the default
keyboard action. It leaves disk contents untouched and does not undo already completed autosaves.

For quit, collect affected files into one save-changes dialog. Offer **Save All**, **Don't Save**,
and **Cancel**, naming the files whose unsaved work will be lost. Saving must retain native version
guards: if a file cannot safely save, offer Save As rather than silently overwriting incoming work.
After a partial save, update the remaining list. Cancellation keeps the app open. A changed set of
unsaved files must not inherit an earlier discard decision.

Unsubmitted comment and reply drafts need explicit wording: closing discards them, while saving
Markdown does not preserve them. A draft-only close offers **Discard Draft** and **Cancel**. For
mixed edits and drafts, disclose draft loss in the same dialog before the user chooses a closing
action; never silently submit a draft or add a second confirmation after that choice.

A native write that never completes remains a separate implementation question. Cancelling close
must remain available. A timeout cannot imply rollback or make Don't Save claim to cancel an
already dispatched write. Validate the host's termination behavior before specifying a force-exit
control; do not add an unfamiliar exit flow solely for this hypothetical state.

## Comment layout and movement

Use the actual document width, fixed card width, gap, and available viewport as the layout inputs.
The current unrelated 1180 px rule should not choose an asymmetric gutter split.

- If the right margin fits the cards and their gap, keep the document at its no-comments position.
- Otherwise, center the bounded document-plus-comments group with equal outer margins. Allocate
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

Give the top-right controls the Open control's normal text weight, matching square surface, border,
radius, and icon footprint. Preserve a distinct selected state for Comments and Translation.
Do not fix visual weight merely by thickening a few unrelated SVG paths. Keyboard focus, tooltips,
and Chinese accessible names remain part of the same controls.

## Implementation sequence and acceptance

1. Address reproducible persistence defects with failing regression tests first. Keep the
   intermittent native comment report open until its trigger is identified or measured.
2. Apply the settled editor-conventional exit policy and review the notification hierarchy, then
   implement the lifecycle states and
   their transitions before polishing recovery controls. Use the existing native host, Radix
   popovers/menus, and shared notification area; no new UI framework is needed.
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
