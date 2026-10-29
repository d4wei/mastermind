# Direction

- Add only an unresolved question, deliberate deferral, or directional bet that is not yet true in
  the project and has both a why and an exit condition.
- Do not use this file as a task backlog. Reject entries that lack a why or a condition that removes
  them.
- Move a settled choice to `DECISIONS.md`; move a built contract into the code and its colocated
  docs; delete a dropped entry. Record a dropped choice only when it constrains future work.
- Keep each entry to a few lines. Move self-contained depth to `docs/<topic>.md` and leave one
  pointer here.
- Add the newest entry directly below the divider. Append `(updated YYYY-MM-DD)` to the heading
  after a substantive edit.

Use this entry shape:

```
## YYYY-MM-DD — <title>

**<Bet | Deferral | Open question | Gap>.** <why it remains open.>

**Exit:** <the ruling, build, or measurement that resolves it.>
```

Before adding or editing an entry, cross-check `DECISIONS.md` and the project, then graduate every
entry that has already resolved.

* * *

## 2026-10-29 — Curated font presets

**Bet.** Presets should be complete pairings of display, body, code, and CJK fallback faces, and
fewer of them; most current presets pair a display face with itself as body text and name no CJK
face. The recommended set and the preference migration are in
[curated font presets](docs/font-presets.md).

**Exit:** a ruling on the preset set, then the registry, stacks, and settings ship it and the
design is deleted.

## 2026-10-29 — Pathological autolink parsing

**Gap.** The pinned `mdast-util-gfm-autolink-literal`, pulled in by `remark-gfm`, is quadratic on
long runs of `.`, so a crafted file still hangs the renderer after the scanner and label fixes;
the parse of 20k dots alone takes seconds. A bound on the input is not a fix, since the parser
runs on every edit.

**Exit:** a pinned upstream release with linear behavior, a pre-parse guard that disables autolink
literals for such runs, or an accepted limit recorded with its measurement.

## 2026-10-29 — Windows endpoint squatting

**Gap.** The named pipe `\\.\pipe\mastermind-launch-check-<SID>-default` is predictable, and a
pipe another user created first makes `bind` map `ERROR_ACCESS_DENIED` to the same signal as a
running host, so the app exits silently and the launcher polls to its deadline. Server identity is
verified only from the client side, by process ID rather than the pipe object's owner.

**Exit:** on access denial, connect and verify the server's identity before treating it as our own
host, fail loudly otherwise, and check the pipe object's owner SID; verified on Windows through
`tools/desktop/check-access.ps1`.

## 2026-10-25 — Reliable review selections

**Gap.** Selection mapping rejects ordinary formatting boundaries and can silently omit selected
content. Minimize restrictions to those required by exact source edits and the in-file protocol,
and make unsupported actions understandable. The audit and proposed quoted-comment fallback are in
[selection review](docs/selection-review.md).

**Exit:** settle the fallback representation, implement positional mapping and explicit coverage,
and verify the selection matrix and native interactions; graduate the contract beside the code.

## 2026-10-17 — Local persisted work buffers

**Bet.** A local persisted buffer can preserve pending document edits and unfinished comments,
replies, and suggested changes together with the source revision, target, and context they depend
on. Autosave alone does not cover these interrupted operations. Persistence preserves the work;
resuming still requires target validation, and undo must not restore an obsolete file snapshot.
Accepted review feedback continues to reach agents through the Markdown file only.

**Exit:** settle storage, retention/discard rules, restoration scope, and stale-target behavior;
reconcile the ephemeral-session and no-database constraints in a ruling, then implement and test
recovery across external file changes and app restarts, or explicitly drop the proposal. This
supersedes the general session-restoration deferral without adopting a storage mechanism.


## 2026-10-17 — Intermittent comment-triggered conflict (updated 2026-10-29)

**Gap.** The reported comment-triggered warning has not been reproduced. A transient-read recovery
defect and three plausible triggers were fixed: a metadata-only change to a mixed line-ending file
and a native missing-file read misread as a failure (`6b5cdde`), and a preview save racing the event
poll reported as deletion (`27ac137`; the preview is since retired). A metadata-only change (such as
an extended attribute or mode change) altered the Unix version token and rejected the next save;
that trigger is now tolerated in `desktop/src/files.rs`. None is confirmed as the cause. Recovery
and exit follow the [document contract](ui/documents/store.md). Capture the source revision, pending
write, watcher event, and native error classification if the warning recurs.

**Exit:** capture and fix the trigger, or explicitly defer it with diagnostic requirements recorded.

## 2026-10-14 — Native file picker latency

**Deferral.** macOS panel creation and sheet presentation dominate the observed delay. Retaining
the panel reduced a repeat-open trace from about 460 ms to 285 ms but did not improve first open.
The pinned dialog library does not expose reuse; avoid adding a separate macOS picker for now.
Measurements and the experiment are in [picker latency](desktop/picker-latency.md).

**Exit:** a library-supported optimization or an approved native implementation improves measured
latency without changing file admission, or the remaining delay is accepted.

## 2026-10-13 — Native release hardening

**Gap.** Tauri is adopted. Remaining desktop interactions, filesystem coverage, installation, and
platform input checks are recorded once in [native validation](tools/desktop/results.md).
Adoption is not a claim that these release checks have passed.

**Exit:** the relevant checks pass before a release claims their support, or their scope is
explicitly revised.

## 2026-10-10 — Repository language settings (updated 2026-10-17)

**Open question.** Agents prepare translations with explicit source and target languages, guided
by user requests and session context. Whether repository language defaults add value still needs
a ruling; no repository storage, discovery, or precedence mechanism has been selected.

**Exit:** a ruling and implementation for repository settings, or that mechanism is dropped.

## 2026-10-10 — Package and CLI identity (updated 2026-10-13)

**Open question.** The npm project is private and retains the inherited name `mastermind-md`.
The native app identifier and executable names remain provisional. Select public command, package,
and settings
identity before distributing or installing alongside
[Mastermind](https://github.com/Jingquank/Mastermind).
The repository launcher does not install a global command.

**Exit:** a distribution-identity ruling applied to packaging, launcher installation, and native
settings storage.

## 2026-10-10 — Markdown wrapping stays manual

**Deferral.** Project Markdown is hard-wrapped at 100 columns by hand. Automatic formatting must
exclude `tests/fixtures/*.md`, which are preserved source samples. No wrapping hook is installed.

**Exit:** a formatter with path exclusions is adopted, or the wrapping requirement is dropped.
