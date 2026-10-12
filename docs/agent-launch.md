---
status: living
updated: 2026-10-11
exit: the launch contract is ruled and implemented with colocated docs, or the proposal is dropped
---
# Opening files from an agent

Approved launch and onboarding behavior, with native transport and packaging still to validate.
Settled constraints live in [DECISIONS.md](../DECISIONS.md). This design does not change the current
command; the proof of concept below precedes desktop integration.

## Opening operation

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

## Opening behavior

| Situation | Result |
| --- | --- |
| App is closed | Start it and add the chosen documents to one review window. |
| App is running | Add documents to the existing window without closing other documents. |
| A chosen file is already open | Reuse its buffer, undo history, and save/conflict state. |
| Paths name the same canonical file | Open once; return a result for each path on stdout. |
| Some files cannot be opened | Open valid files; return individual failures on stdout. |
| No files are supplied to `open` | Return an invocation error; do not create a blank draft. |
| Graphical start without files, setup incomplete | Show onboarding with an Open files action. |
| Graphical start without files, setup complete | Show Open files; do not repeat onboarding. |

Preserve input order among newly opened documents. Activate the first successfully admitted file
from the request and ask the OS to bring the window forward. Do not promise that the OS will grant
focus. Repeating a request does not reset existing documents, duplicate buffers, or force a reload.
A request for a missing path reports a failure without discarding any existing recoverable buffer.

### External changes and conflicts

The current [document-state contract](../src/ui/app/store.md) defines the conflict interaction:
clean buffers reload external changes; dirty buffers pause saving and retain Base, Local, and Disk.
The persistent notice opens a comparison with an editable Result. Save result uses the reviewed
Disk version and captured Local revision; if either changes, explicit refresh is required while
preserving Result. Use disk keeps the discarded Local text in undo. Missing or unreadable files
retain recoverable text without implicit recreation. Closing comparison or switching documents
retains the draft.

Reopening an existing document must preserve this interaction, including a comparison already in
progress. Native validation must exercise the whole flow, not just reject a stale write. Native
quit must wait for saves or let the person return to recoverable errors; it must not silently
discard unsaved buffers or edited Results. This is a host validation requirement, not a claim
about what browser unload can do.

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

Stdout contains one structured result, with diagnostics on stderr. Preserve request order
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

## Onboarding assistance

Opening files does not set names or language preferences. Remove the proposed `open --name` and
language flags. The agent-facing interface should expose incomplete onboarding and accept optional
prefills through a separate setup operation. People see, edit, and confirm those suggestions in the
GUI. The setup operation's command spelling and payload remain implementation details.

Initial setup and file admission:

1. `open` starts or reuses the app and returns the file results. If setup is incomplete, include an
   `onboarding_needed` indication and guidance for the agent to offer setup assistance.
2. The agent may supply Name, Interface language, and Translation language suggestions through the
   separate setup operation. It reports which suggestions were accepted for display and which
   were ignored because the person has already configured or started editing that field.
3. The app shows suggestions in onboarding. Only the person's edit or confirmation saves them.
   One short setup screen precedes the normal reviewer. Completing it reveals the accepted files;
   another opening request is unnecessary. Additional requests add files without restarting setup.

Confirm a usable Name, initially suggested by the agent or Git. Interface language starts with a
supported system language or fallback. Translation language starts with Original only or an agent
suggestion and remains optional. Setup/demo guidance is not a completion requirement. There is no
partially enabled reader and no per-action onboarding gate.

Changing Interface language updates controls. Changing Translation language clears the previous
translated view; a matching fresh translation can be shown, otherwise the original remains
available with an explanation. Existing comments retain their authors, quoted passages, and
language tags. Changing Name affects future comments. These are ordinary settings behaviors,
shared with onboarding rather than a separate first-run implementation.

Saved choices win, including an explicit Original only translation choice. Opening alone never
writes settings. An unconfirmed prefill is transient and is lost on quit. A later agent request
cannot overwrite a form the person has begun editing. Distinguish explicitly saved choices from
computed defaults; a merged preferences response alone cannot supply that distinction.

The Name question remains “What should we call you?” / “怎么称呼你？”, using the canonical
[terminology](terminology.md). Existing Git-name fallback remains available where no name is set.
An agent that needs a translation prepares it using the separately requested or saved language;
unconfirmed onboarding suggestions do not silently alter translation preparation.

Keep Project language out of this setup interface until repository settings have a storage,
discovery, and precedence ruling. A batch may span repositories; a setup suggestion must not become
an accidental global repository policy. The approved role of Project language is unchanged.

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
  Windows. The isolated experiment pins this dependency; production adoption still depends on its
  validation results. Its API alone does not establish endpoint permissions or packaging behavior.

Pin adopted versions and test their relied-on behavior when implementing. Keep this transport
separate from the React-to-Rust host bridge for reads, writes, and file watching. The browser
development adapter can remain HTTP-based without entering the shipped desktop runtime.

### Validate the launch boundary before migration

The isolated [native launch experiment](../tools/native-launch/README.md) and its
[observations](../tools/native-launch/results.md) own validation evidence and remaining gaps.

Build a disposable, packaged native proof of concept before connecting the production editor or
removing the current host. It needs a launcher, a minimal window, admitted-file state in memory,
and controllable failures. Validate the actual release packaging and terminal invocation; a Rust
unit test or development-mode window cannot settle application discovery and console behavior.

| Question | Experiment and required observation |
| --- | --- |
| Can an agent find and launch the installed app? | Cold launch from another cwd with real paths. |
| Does the packaged launcher return useful results? | Capture stdout, stderr, status, and timeout. |
| Is there one owner during simultaneous launches? | Race cold starts and inspect admitted files. |
| Does acknowledgment mean admission? | Delay the UI; query retained state after it becomes ready. |
| Is retry safe after response loss? | Drop the reply after admission; retry without duplicates. |
| Are endpoint ownership and cleanup correct? | Exercise stale endpoints and foreign owners. |
| Are filenames preserved? | Pass spaces, Chinese, leading hyphens, and encoding edge cases. |
| Do failures remain bounded? | Crash at startup/admission/reply; send invalid and oversized data. |

Record the candidate versions, packaging commands, observations, and failures in the proof of
concept's results. Select the launcher shape and transport only after these checks. Start on macOS;
run the same launch tests on Windows and Linux before calling the transport portable. A missing
runner is an evidence gap, not a passing check. If a platform needs a different launcher shape,
revise this design before expanding the prototype into the editor host.

No backward compatibility is required for the existing CLI, preference-reading tools, translation
commands, or their stored formats. Remove or replace them as the new design requires; do not build
adapters, aliases, migrations, or parallel implementations solely to preserve them. Agent-prepared
translations and confirmed personal preferences remain product capabilities, not promises to retain
old command contracts. No Node sidecar enters the desktop app.

## Validation before replacing the current launcher

1. Cold and warm multi-file opens; relative paths from different working directories; spaces,
   Chinese names, leading hyphens, symlink aliases, and an explicit path-encoding failure.
2. One valid and one missing file; permission failure; directory/device rejection; a changed file
   during admission; concurrent requests for the same file and simultaneous cold launches.
3. Reopening during an unsaved edit, slow save, conflict comparison, and missing-file recovery;
   retain the correct document buffer, undo history, and guarded write behavior in every case.
4. Delayed UI startup; app failure before acknowledgment; response loss after admission; timeout
   followed by retry. Confirm results describe admission rather than review completion.
5. Separate setup suggestions with missing or saved preferences, explicit Original only, an edited
   but unconfirmed form, repeat requests, and files from several repositories. Opening must not
   mutate settings; verify incomplete-setup results against the chosen onboarding interaction.
6. A packaged macOS launch plus Windows/Linux native runs for arguments, IPC ownership, console
   output, and app focus behavior. Missing platform runners remain explicit evidence gaps.

## Validation next step

The review settles additive opening, per-path results, preservation of existing documents,
separation of opening from preference suggestions, and no compatibility obligation to the old CLI.
Incomplete onboarding accompanies successful file admission; the GUI shows setup before the
reviewer. Front-load the native proof of concept before host migration, then revise this document
from its findings.

[single-instance]: https://v2.tauri.app/plugin/single-instance/
[macos]: https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/single-instance/src
[cli]: https://v2.tauri.app/plugin/cli/
[local-sockets]: https://docs.rs/interprocess/2.4.5/interprocess/local_socket/index.html
