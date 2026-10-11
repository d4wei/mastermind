# User preferences

`config.ts` reads and patches the per-user config file located by `paths.ts`. A configured
`authorTag` takes precedence, including a tag saved by an older release. Missing tags default to
`git config --global --get user.name`, normalized to a single CriticMarkup author token of at most
64 characters. Unicode letters and numbers are retained; spaces and delimiters become hyphens.
If Git is unavailable, times out, or supplies no usable name, the tag is `reviewer`.

The global Git scope matches the shared per-user preferences: launching a daemon from one
repository must not give all its other workspaces that repository's author identity. Reading
preferences does not create a config file. Any normal preference update persists the merged
configuration. The Name field in Settings edits `authorTag`; it is also available through
`mastermind config set`.

`tests/config-author.test.ts` checks default signatures, normalization, fallback, and overrides.

The Translation language field stores an optional personal language code in `translationLanguage`,
defaulting to `null` for original-only reading.
It chooses which complete prepared artifact the browser can read; the invoking agent supplies the
source and target codes explicitly for each preparation pass. The retired language-pair preference
is not read or migrated. CLI preferences accept `translationLanguage=CODE` or
`translationLanguage=null`. The Font preset field stores its registry ID in `fontPreset`.

Existing files may contain `comfortLang` and `typeSet`. Read them only when the corresponding
canonical key is absent. Presence takes precedence over value: an explicit `translationLanguage:
null` disables translation even if `comfortLang` also names a language. An invalid canonical
language or font value uses its default rather than reviving a shadowed earlier value.

Reading never rewrites preferences. The next successful update writes canonical keys and preserves
other recognized preferences; it removes the earlier names from the saved JSON. CLI and API updates
accept only canonical keys. Unknown keys, attempts to change `version`, and invalid values for these
two preferences fail before writing. This is a preference-key migration, not a translation-file or
review-mark format change. Restart the local file service when upgrading its configuration API.
