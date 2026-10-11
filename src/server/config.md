# User preferences

`config.ts` reads and patches the per-user config file located by `paths.ts`. A configured
`authorTag` takes precedence, including a tag saved by an older release. Missing tags default to
`git config --global --get user.name`, normalized to a single CriticMarkup author token of at most
64 characters. Unicode letters and numbers are retained; spaces and delimiters become hyphens.
If Git is unavailable, times out, or supplies no usable name, the tag is `reviewer`.

The global Git scope matches the shared per-user preferences: launching a daemon from one
repository must not give all its other workspaces that repository's author identity. Reading
preferences does not create a config file. Any normal preference update persists the merged
configuration, and the author tag can be changed in Settings or with `mastermind config set`.

`tests/config-author.test.ts` checks default signatures, normalization, fallback, and overrides.
