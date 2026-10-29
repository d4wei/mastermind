# Native initial setup

`setup.rs` owns initial completion, transient suggestions, and protection for fields the person has
begun editing. File admission remains independent. The existing local transport accepts either
an opening request or a separate `{ "version": 1, "setup": { ... } }` request; it uses the same
frame limit, ownership checks, and deadlines. The native command sends the latter with:

```sh
mastermind-launch-check setup --suggest '{"authorTag":"Reader","uiLang":"en"}'
```

The Windows command uses `mastermind-launch-console.exe` with the same arguments. Only `authorTag`
and `uiLang` are accepted. Name and Interface language cannot be null. Unknown fields, an empty
suggestion, and invalid values reject the whole request before mutation. Valid fields report
`accepted` or `ignored` in `setup_results`. Saved fields, protected fields, and completed setup
ignore agent suggestions. Suggestions never write preferences and disappear when the host exits.
When saved preferences cannot be read or validated, a suggestion fails with the stable code
`preferences_unreadable`, and the launcher exits with status two.

Successful opening and setup replies report actual `onboarding_needed`. When preferences cannot be
read or validated, admission still succeeds and the value is null. Invocation failures, rejected
requests, and unknown outcomes also report null rather than guessing completion. Per-file results
retain their existing semantics. Setup acknowledgments do not mean a person has confirmed the
suggestions.

The GUI commands return `{ completed, revision, values, saved, protected }`. The latter three
objects use the same field keys. `setup_snapshot({uiLangDefault?})` uses a supported system language
supplied by the GUI when that field is neither saved nor suggested. It retains the default across
other command responses. `protect_setup_fields({fields})` retains protection for the host lifetime.
The GUI also protects local edits immediately while that command is pending.

`confirm_setup({values})` requires both fields. It reads the current saved object, preserves
unrelated settings, and makes one atomic preference replacement containing the confirmed values
and `onboardingCompleted: true`. Only successful replacement changes transient state or completion.
Failure leaves suggestions, protection, and revision available for retry. Malformed preferences
are reported without overwriting them; completion true requires both usable saved choices.

Presence of each choice key in the saved JSON is its saved metadata. Computed defaults are absent;
ordinary `write_preferences({patch})` merges only patched fields into the saved object. It cannot
change completion. Reads do not persist merged defaults. Commands share the setup mutex and the
existing blocking-work gate; no filesystem work or Git lookup runs on the event loop. Preference
byte bounds and the atomic writer remain in [`preferences.rs`](preferences.rs).

Name is trimmed and an initial @ removed, matching Settings. Its allowed characters and UTF-16
length follow the existing CriticMarkup author parser in `document/critic/scanner.ts`; spaces and
Chinese names remain valid. Interface language accepts the existing supported codes. The initial
Name uses global Git configuration only, with bounded subprocess time and output; unusable or
unavailable results use `reviewer`. On macOS, Git runs only when it resolves outside `/usr/bin` or
`xcode-select -p` reports a developer directory, because `/usr/bin/git` otherwise opens the Command
Line Tools installer. Git defaults replace forbidden author characters and stop at the
author length bound. A repository-local identity is never consulted.

`MM_LAUNCH_CHECK_PREFERENCES` is a trusted test-harness override naming an absolute preference
file. A relative override rejects startup. Without it, preferences use the existing native app
config directory's `reviewer.json`. Process checks use disposable files so saved choices and
completion never depend on the developer's preferences. This does not settle production storage
or application identity.

Rust tests check defaults, per-field presence, protected edits, strict validation, source-compatible
names, atomic confirmation failure/retry, ordinary patches, and restart behavior. Process harnesses
check separate setup responses and truthful admission state; the installed reviewer harness
exercises human confirmation and its recovery flow.

The retired `translationLanguage` field is ignored when reading existing preferences and rejected
in new patches and setup suggestions. A subsequent write drops it while preserving other settings.
Reading language belongs to the document session, not native preferences.
