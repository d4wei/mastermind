# YAML frontmatter

The shared Markdown processor recognizes a leading YAML fence through the pinned
`remark-frontmatter` extension. [Reading presentation](../../ui/modes/reading/frontmatter.md)
owns how the metadata renders. Markdown mode retains the full fence and contents.

Frontmatter is opaque to CriticMarkup scanning and is not sent for translation. The reading view
omits review-position attributes for metadata, so selection cannot insert invisible review marks
inside it. Body positions still refer to the original source, including CRLF offsets; edits remain
source splices and never serialize the YAML.

Behavior checks live in `tests/frontmatter.test.tsx`.
