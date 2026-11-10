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

## 2026-11-08 — Japanese interface text renders in Simplified Chinese glyph forms (updated 2026-11-10)

**Gap.** Characters whose regional forms differ (直, 令, 骨 and the like) take the shape of the
face that draws them. Both phases of [CJK glyph forms](docs/cjk-glyph-forms.md) shipped: Noto JP
is bundled beside Noto SC, documents and blocks resolve a language (frontmatter, the agent's
`open --document-language` hint or a prepared translation's `sourceLang`, script detection) and
carry it as `lang`, the stacks follow it, and the Traditional Chinese, Hong Kong and Korean faces
arrive as fetched packs under the 2026-11-09 network ruling. The contract lives beside
`ui/theme/fonts.md`. What remains is a check in the running app: 直令骨辺 in a Japanese and a
Chinese document under each interface language, and a Traditional Chinese document before and
after its pack arrives, online and offline.

**Exit:** the check passes in the running app and the design file is deleted.

## 2026-11-07 — Documents above a few megabytes still freeze the window while they parse (updated 2026-11-08)

**Bet.** Even with the micromark truncation patched (`document/markdown/processor.md`), a whole
document parse costs about 0.5 µs per byte and runs on the renderer's main thread, so a 4 MB file
blocks for seconds and a 15 MiB one for far longer, during which the window cannot paint. Two
prototypes measured on the `tools/perf` fixtures (2026-11-08, headless Chrome and the jsc shell): a
markdown-rs WASM parser is 3–5× faster than the JS parser once its own quadratic edit map is
patched, but stock 1.0.0 is quadratic, panics on an unclosed fence in a list item, and needs a
compatibility pass to match today's trees, with structural differences left; not adopted. Windowed
rendering makes the 15 MiB fixture interactive (mount 31.5 s to 0.5 s, 16 ms frames) but breaks
every reader of the whole DOM (rail anchors, Navigator, reveal, Find, selection, print), a
two-to-three-week contract change. `content-visibility: auto` on every block, with the rail, Find,
mark gutter and smooth scrolls taught to read a skipped block's box instead of positions inside it,
removes every cost it added at 600 KB and keeps all readers correct, and WebKit supports the
properties and the state-change event (no scroll anchoring, so a manual compensation is needed); but
at 15 MiB Chrome spends about 700 ms per frame managing 98k skipped elements even while idle, so
per-block skipping does not scale, and whether skipping larger chunks does is unmeasured (and those
runs measured an unstyled page: the harness left the theme attribute unset, so their spacing and
widths were not the app's). The comment rail was the other whole-document reader, mounting and
measuring every card; it is now windowed (`DECISIONS.md`, 2026-11-08), so rail cost no longer grows
with marks. Edits stay dominated by re-analysis in every variant (0.6 s at 600 KB, 28 s of a 71 s
edit at 15 MiB, the rest React re-rendering the article). The JavaScriptCore blow-up seen earlier
(25 s at 8 MiB against 6 s in Node) did not reproduce on an idle machine: it was memory pressure (a
parse holds 3–4 GB at 8–15 MiB, and the runs were made at load 29–36), and the mild superlinearity
both engines shared was a quadratic sibling lookup in `mdast-util-find-and-replace`, now patched
(`document/markdown/processor.md`); after it the parse is near-linear in both engines (jsc 9.2 s,
Node 7.4 s at 15 MiB), with the next quadratic, mdast-util-from-markdown's list handling, removed by
its 2.1.0 (`document/markdown/processor.md`), and nothing measured inside WKWebView, whose memory
limits may bind before time does. Neither parser has an active upstream: markdown-rs has been quiet
for over a year with the panics and the quadratic profile already reported, and micromark is barely
maintained, so fixes to either live in a local patch or fork, as micromark's already does. A size
threshold above which the reading view yields to the source view is a candidate policy, not a
ruling.

**Exit:** the parse moved off the main thread, or re-parsed per changed block; the parse's memory
footprint measured inside WKWebView; `content-visibility` on the article left alone; then a ruling
on the size policy, if one is still needed.

## 2026-11-07 — Restoring remembered files reads every one before the first reply

**Open question.** Restoration reads each remembered document's content before the triggering
launcher request is answered (`desktop/src/restoration.md`), which keeps "admission reads and
retains a snapshot before reporting success" but costs about 350 ms with six 15 MiB files
remembered. Deferring the content read of inactive restored documents to their first
`read_document` would relax that contract for the restore path alone.

**Exit:** a ruling on whether a restored, inactive document may be admitted from metadata alone.

## 2026-11-07 — Remembered files on volumes that are not mounted at launch

**Open question.** A remembered document that cannot be reopened at launch is dropped from the
inventory after one persistent notice, as `desktop/src/restoration.md` states. A file on an external
drive, a network share, or an evicted cloud-sync folder is often missing only at login and present
minutes later, so the drop is a real loss for those readers, while keeping unreachable paths forever
would reopen stale files and confuse the open-files list.

**Exit:** a ruling on whether a missing file stays remembered (for how many launches, or until the
reader dismisses it) or is forgotten at once, then the inventory rule and notice copy that follow.

## 2026-11-07 — Several agents on one file

**Gap.** Opening and closing assume one agent hands a file to the person and takes it back. A close
from one agent removes a document another agent still has under review, and two agents editing the
same document race each other and the person through the file. The host also cannot forget a
remembered document while it is not running, so a close then reports `not_open` and the document
reopens at the next launch. Each needs a change to the handoff model, such as per-agent ownership
of open documents, not a patch to the close path.

**Exit:** a ruling on ownership of open documents across agents, then a handoff that closes only
what no one else holds and forgets remembered documents without a running host, or an accepted
single-agent limit recorded in `DECISIONS.md`.

## 2026-11-07 — Recursive for the Markdown source mode

**Bet.** Recursive's continuous axis between proportional and monospace could suit the Markdown
source mode better than the preset's code face, keeping prose readable while syntax stays aligned.
It was set aside from the font presets because it serves editing, not reading.

**Exit:** a source-mode trial with Recursive bundled adopts it as the source face or drops the idea.

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

## 2026-10-25 — Reliable review selections (updated 2026-11-08)

**Gap.** Positional source mapping, formatting-aware fragments, and explained exclusions shipped
(`af58e6f`); the contract lives in `ui/modes/reading/selection.md`. Still open: the in-file
representation of a quoted-passage comment for selections that cannot carry a mark, which would
also let one comment cover every fragment of a multi-fragment selection instead of anchoring to the
first, and reach opaque blocks (code, raw HTML, frontmatter) that no inline mark can enter; a
selection inside an existing discussion, which the toolbar explains but does not yet offer to open
for a reply; native WebKit verification of the fixture matrix, including fast drags and keyboard
selection; and marks directly against underscore emphasis, which the masking sentinels' flanking
class refuses rather than silently breaking. The fallback's design is in
[selection review](docs/selection-review.md).

**Exit:** settle the quoted-comment representation or drop it, verify the matrix in the native
app, and choose mask sentinels whose flanking class matches the delimiters they replace.

## 2026-10-17 — Local persisted work buffers (updated 2026-11-07)

**Bet.** A local persisted buffer can preserve pending document edits and unfinished comments,
replies, and suggested changes together with the source revision, target, and context they depend
on. Autosave alone does not cover these interrupted operations. Persistence preserves the work;
resuming still requires target validation, and undo must not restore an obsolete file snapshot.
Accepted review feedback continues to reach agents through the Markdown file only.

The set of open documents already reopens at launch (2026-11-07 ruling); everything else in the
review session ends on quit.

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

## 2026-10-10 — Package and CLI identity (updated 2026-11-08)

**Open question.** The npm project is private and retains the inherited name `mastermind-md`.
The native app identifier and executable names remain provisional. Select public command, package,
and settings identity before distributing or installing alongside
[Mastermind](https://github.com/Jingquank/Mastermind). The repository launcher does not install a
global command, and installing from the repository is the distribution (`DECISIONS.md`,
2026-11-08). Prebuilt releases wait on this ruling and on a reason to spare users the Rust
toolchain: an outside user asking for a build, or the repository front page and outreach starting.
When that comes, the cheapest form is unsigned tagged GitHub Releases (the macOS app, the NSIS
installer and the deb that CI already builds) with a checksummed fetch step that places the binary
where `bin/mastermind.js` looks, and a Gatekeeper caveat in the README; a signed installer with a
packaged CLI is a later step, taken only if release users hit the signing warnings or want
distribution without a checkout.

**Exit:** a distribution-identity ruling applied to packaging, launcher installation, and native
settings storage, followed by the first tagged release when one of the triggers above fires.

## 2026-10-10 — Markdown wrapping stays manual

**Deferral.** Project Markdown is hard-wrapped at 100 columns by hand. Automatic formatting must
exclude `tests/fixtures/*.md`, which are preserved source samples. No wrapping hook is installed.

**Exit:** a formatter with path exclusions is adopted, or the wrapping requirement is dropped.
