---
status: living
updated: 2026-10-11
exit: the launch contract is ruled and implemented with colocated docs, or the proposal is dropped
---
# Opening files from an agent

Proposal for review. The desktop host is already selected; this document proposes the remaining
agent launch behavior. It does not change the current command or establish a DECISIONS.md ruling.

## Recommendation

Provide one opening operation that accepts several explicit files, starts or reuses the desktop
app, and returns a result for each file. People open files graphically. Agents use a short-lived
native launcher; neither waits for review completion.

```sh
mastermind open -- docs/plan.md "docs/design notes.md"
```

`mastermind` illustrates the operation using the current command name. The installed executable,
application ID, and configuration location still need the distribution-identity ruling.

The launcher is a command-line entry point packaged with the desktop application. It may be a small
console executable or a mode of the app executable; packaging tests should decide that detail.
It starts the app when necessary and exits after receiving the opening results. It is not a resident
helper, a Node runtime, or an independently managed service. Skill installation does not silently
edit shell profiles or install competing copies of the executable.

## Proposed user-visible behavior

| Situation | Result |
| --- | --- |
| App is closed | Start it and add the chosen documents to one review window. |
| App is running | Add documents to the existing window without closing other documents. |
| A chosen file is already open | Reuse its buffer, undo history, and save/conflict state. |
| Several paths name the same canonical file | Open it once; report every supplied path's result. |
| Some files cannot be opened | Open the valid files and report the failures individually. |
| No files are supplied to `open` | Report an invocation error; do not create a blank draft. |
| App starts graphically without files | Show its graphical entry point/onboarding. |

Preserve input order among newly opened documents. Activate the first successfully admitted file
from the request and ask the OS to bring the window forward. Do not promise that the OS will grant
focus. Repeating a request does not reset existing documents, duplicate buffers, or force a reload.
Clean external changes and conflicting dirty buffers continue to follow the existing file rules.
A request for a missing path reports a failure without discarding any existing recoverable buffer.

Finder opening, native file dialogs, and drag/drop use the same file-admission operation. These
entry points report failures in the app rather than to a command's stdout. No directory tree,
recursive search, Git eligibility rule, or interpretation of Markdown instructions is part of open.

## What success means

Return after the host has validated each path, read a consistent initial file snapshot where needed,
and registered the document for the review window, or identified an already-open document.
The UI must be able to obtain that state after startup; a transient event emitted before it listens
is insufficient. Success does not wait for the first rendered frame, onboarding, translation,
saving, or a person's review. It is not approval of the document.

Use a bounded startup/response deadline. A timeout or broken connection leaves the outcome unknown:
some files may already be open. Report that uncertainty and allow a safe retry; do not kill the app,
roll back admitted documents, or claim that nothing happened. Validate the deadline against
cold-start measurements; keep it an implementation constant rather than another user setting.

Proposal: stdout contains one structured result, with diagnostics on stderr. Preserve request order
and distinguish `opened`, `already_open`, and `error`, with a stable error code and readable
message for failures. Check protocol versions before processing requests. Exit successfully only
when every supplied path succeeded; distinguish malformed invocations, per-file failures, and
unknown delivery outcomes with nonzero statuses. Exact keys and numeric statuses belong in the
implementation contract and its tests.

The result includes file identity and opening status, never document contents or review feedback.
There is no review-complete event, callback URL, polling command, or saved receipt file. The agent
rereads the Markdown when the person asks it to continue.

## Files and failure handling

- Resolve relative paths against the launcher's working directory, not the already-running app's
  startup directory. Capture that directory for the request. Use native argument handling rather
  than constructing a shell command; spaces, Chinese filenames, and leading hyphens must survive.
- Accept existing readable regular files as Markdown, without guessing eligibility from Git or
  requiring a particular filename suffix. Reject directories, URLs, devices, and pipes. Do not
  create missing files, traverse directories, or execute document contents.
- Use canonical paths for duplicate detection, matching the current document identity contract.
  Preserve the user's supplied path for diagnostics. Symlink and replacement handling must retain
  the protections in [file I/O](../src/server/files.md); canonicalization alone is not a safe read.
- Parse and validate the request envelope and option syntax before admitting any file. Once the
  request is valid, isolate file failures so one missing document does not block the others.
- Serialize competing admissions for the same canonical path. Concurrent cold starts must produce
  one document owner, and reopening a dirty document must never replace its buffer with disk text.
- Do not silently replace unrepresentable filename characters. Native path encoding must round-trip
  across the launch boundary or produce an explicit unsupported-path error before opening.

## Optional onboarding values

Allow optional Name, Interface language, and Translation language values as **onboarding prefills**.
For example, `open --name "Alex" -- docs/plan.md` suggests the initial name; it does not impersonate
that name for one review or overwrite a saved preference.

For a field the person has not configured, show the invocation value ahead of defaults. Saved
personal choices win, including an explicit Original only translation choice. Editing or confirming
a prefilled field in the GUI persists it; opening alone does not write settings. An unconfirmed
prefill is transient and is lost on quit. Do not let a later launch overwrite a form the person has
already begun editing. Readable documents remain available while optional setup is unfinished.
The implementation must distinguish explicitly saved choices from computed defaults; a merged
preferences response alone cannot supply that distinction.

The Name question remains “What should we call you?” / “怎么称呼你？”, using the canonical
[terminology](terminology.md). Existing Git-name fallback remains available where no name is set.
An agent that needs a translation prepares it using the separately requested or saved language;
unconfirmed onboarding suggestions do not silently alter translation preparation.

Keep Project language out of the first launch interface until repository settings have a storage,
discovery, and precedence ruling. A batch may span repositories; one launch-level value must not
become an accidental global repository policy. The approved role of Project language is unchanged.

## Native implementation seam

Inter-process communication (IPC) here is a short request and response between a launcher and the
running local app. The endpoint exists only while the app runs. It carries explicit file-opening
requests, not a second channel for comments or document edits. No TCP port, HTTP listener, detached
daemon, or Node sidecar is required.

Use established native IPC machinery and keep the application protocol small. Scope the endpoint to
the current OS user and application identity; test endpoint ownership, concurrent startup, stale
endpoint recovery, incompatible versions, malformed requests, and bounded message sizes. A
repository must not choose the executable to launch or the IPC destination. Quit remains governed
by save completion and recoverable errors, independently of the launcher connection.

Research checked 2026-10-11:

- Tauri's [single-instance plugin][single-instance] forwards arguments and the invoking working
  directory. Its callback provides no application result. In the inspected [macOS source][macos],
  `platform_impl/macos.rs`, the second process exits after writing arguments; it reads no reply.
  That is insufficient evidence for successful file admission. Use it where its behavior fits;
  do not build a second overlapping launch path merely to retain the plugin.
- Tauri's [CLI plugin][cli] uses clap for arguments. Its documentation also flags Windows console
  output as requiring additional handling in production GUI applications. Test the packaged
  launcher from a real terminal; do not assume a development executable's stdout behavior transfers.
- [Interprocess local sockets][local-sockets] provide Unix-domain sockets on Unix and named pipes on
  Windows. This is a candidate for the request/response transport, not an adopted dependency or
  evidence that endpoint permissions and packaging already meet this application's contract.

Pin adopted versions and test their relied-on behavior when implementing. Keep this transport
separate from the React-to-Rust host bridge for reads, writes, and file watching. The browser
development adapter can remain HTTP-based without entering the shipped desktop runtime.

The existing translation-preparation and preference-reading tools remain available during migration.
This proposal does not retire them or choose their final packaging; replacement requires preserving
their contracts without introducing a Node sidecar into the desktop app.

## Validation before replacing the current launcher

1. Cold and warm multi-file opens; relative paths from different working directories; spaces,
   Chinese names, leading hyphens, symlink aliases, and an explicit path-encoding failure.
2. One valid and one missing file; permission failure; directory/device rejection; a changed file
   during admission; concurrent requests for the same file and simultaneous cold launches.
3. Reopening during an unsaved edit, slow save, conflict comparison, and missing-file recovery;
   retain the correct document buffer, undo history, and guarded write behavior in every case.
4. Delayed UI startup; app failure before acknowledgment; response loss after admission; timeout
   followed by retry. Confirm results describe admission rather than review completion.
5. Onboarding prefills with missing preferences, saved preferences, explicit Original only,
   an edited but unconfirmed form, repeat launches, and files from several repositories.
6. A packaged macOS launch plus Windows/Linux native runs for arguments, IPC ownership, console
   output, and app focus behavior. Missing platform runners remain explicit evidence gaps.

## Rulings requested

Approve additive multi-file opening with per-file acknowledged results; preserve existing buffers
and open valid files even when another path fails. Approve transient onboarding prefills that never
silently overwrite saved settings, with Project language deferred to its repository-settings ruling.
These choices would settle the launch behavior; native implementation and validation would follow.

[single-instance]: https://v2.tauri.app/plugin/single-instance/
[macos]: https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/single-instance/src
[cli]: https://v2.tauri.app/plugin/cli/
[local-sockets]: https://docs.rs/interprocess/2.4.5/interprocess/local_socket/index.html
