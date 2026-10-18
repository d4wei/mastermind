---
status: living
updated: 2026-10-17
exit: Ship document-level language switching and graduate its contract beside translation code.
---

# Prepared translations, without a language preference

## Purpose

Let the preparing agent decide whether translations help and prepare the requested languages. Let
the reader choose among versions that actually exist for the open document. Remove Translation
language from Settings and onboarding; keep Interface language independent.

Explicit requests to the agent take precedence over its discretion, including requests for several
languages or no translation. The app does not generate translations or run a translation queue.
Freshness checks, source mapping, and feedback in the original file remain required.

## Current behavior

The top-right language icon sits beside the Markdown toggle in reading view. It appears only when
the saved Translation language is non-null. Selecting Original only hides it, even if prepared
translations exist. The icon toggles one configured target and the original.

Artifacts already have separate paths for each document and target language. The missing pieces
are discovering them, choosing a version per document, and reacting to artifact changes. The
current store and translated-comment guards use the global preference as their target identity.

## Visual choices for review

All three designs expose the same available versions and preserve the existing file pills.

- **Labeled menu:** the current version, such as 中文, appears beside the reading controls. Its
  menu lists Original and available translations. Recommended: the current language is visible,
  and several languages do not widen the toolbar substantially.
- **Inline choices:** Original, 中文, and Français appear together as compact text choices. Fast
  switching and strong discoverability, at the cost of space. Larger sets need an overflow menu.
- **File-attached menu:** a language button beside the active file pill opens the same list.
  The relationship to the file is explicit, but the additional control competes with file names.

The takes include original-only, one-translation, multiple-translation, and stale-translation
states. A single available version needs no picker. Language names use their native names;
Interface language controls surrounding labels. Regional variants must remain distinguishable.

## Proposed behavior

### Opening and switching

Discover prepared translations when a file opens. Open the original immediately while discovery
runs. Retain the selected reading version separately for each open file, for this app session.

Allow the opening agent to request an initial reading language as a presentation hint, without
changing saved settings. The exact launcher/protocol surface remains to be reviewed before build.
Apply the hint only if that document has a matching valid artifact and the reader has not already
made a choice. Otherwise retain the original. Do not introduce a new preparation prerequisite.

Without a hint, start with Original. New artifacts become available without reopening the file;
their arrival does not change a version the person selected. Markdown view always shows the
original source. Returning to reading restores the selected translation only if it remains valid.

### Freshness and errors

Validate each discovered artifact against the current document buffer, independently by language.
Only valid translations are selectable. One malformed or stale artifact must not hide other valid
versions. Keep validation at selection and comment submission; discovery is not authorization to
reuse an artifact indefinitely.

If the selected translation becomes stale, show Original and a dismissible notification in the
existing notification zone: “The document changed. Showing the original.” No modal, generation
request, or waiting screen. Do not repeatedly notify for the same stale artifact. If other valid
translations remain, the switcher still offers them.

Artifact replacement must not silently change an unfinished comment's selected quote. Keep the
captured artifact, language, quote, and draft; require a valid target before submission. Switching
versions must use the existing unfinished-draft policy rather than discard input. Persistent
recovery across app restarts remains the separate work-buffer direction.

### Feedback and source ownership

Translated prose remains read-only. A translated selection produces a comment in the original
Markdown with the precise selected translated passage and its language. Revalidate the captured
artifact and source block before writing. Exact proposed edits remain operations on original text.
Find searches the displayed version and refreshes its matches when that version changes.

### Discovery and boundaries

Keep the current per-document, per-language artifact format. Add a host operation to discover
artifacts for one admitted document; do not add an index file duplicating their identities. Check
filenames, language identifiers, artifact identity, size limits, and canonical path containment.
Treat untrusted filenames and malformed files as inputs, not paths to follow without validation.

Watch relevant artifact changes through the native host, including atomic replacement and creation
of a previously absent translations directory. Coalesce changes and revalidate; ignore results
from a previous document, target, or generation. Close watchers with their document sessions.
The UI store owns selected versions; the shared document layer retains snapshot validation and
source mapping. No translation generation belongs in either host.

## Build sequence after design confirmation

1. Add discovery and change notification at the host boundary. Check existing filesystem watcher
   facilities before adding machinery. Cover multiple targets, missing directories, atomic writes,
   invalid artifacts, and session cleanup.
2. Replace the global target dependency with document-level selection. Exercise navigation, late
   responses, source changes, annotation-only changes, and draft ownership during switching.
3. Build the chosen control and initial-view protocol. Remove the preference from Settings,
   onboarding, setup schemas, native settings, and translations of those labels. Keep Interface
   language and do not add a migration UI for the retired preference.
4. Update the bundled public skill and agent reference: explicit instructions win, several targets
   may be prepared, preparation uses the session's context, and opening never waits on generation.
5. Update canonical terminology and colocated contracts, remove contradictory preference claims,
   and delete this plan when the behavior ships.

## Verification

- Original-only documents open normally with no language control or translation warning.
- Two valid targets coexist; each open document retains its own selected version.
- External artifact creation, replacement, deletion, and invalidation update available choices.
- Original content and review splices remain byte-preserving. Annotation-only changes keep valid
  translations; narrative changes invalidate them before translated feedback can be submitted.
- A stale response cannot replace a newer document or selected version. A draft survives artifact
  replacement without being rebound to different prose.
- Keyboard navigation, English/Chinese interface labels, narrow windows, Find, and Markdown view
  work with the chosen control. Interface language does not select a reading version.
- Run the complete tests, both TypeScript configurations, native tests for the host changes, and
  a desktop build. Verify the resulting native flow with original-only and multilingual files.

## Decisions still needed

Choose the switcher placement from the visual takes. Confirm the initial-view presentation hint
and its launcher spelling when reviewing the implementation contract. The language preference's
removal and the preservation of freshness/source mapping are settled in DECISIONS.md.
