# YAML frontmatter

Both Markdown parsers recognize a leading YAML fence through the pinned `remark-frontmatter`
extension. Reading mode renders its contents as literal metadata using the code-block treatment;
it does not interpret YAML values. Source mode retains the full fence and contents.

Frontmatter is opaque to CriticMarkup scanning and is not sent for translation. The reading view
omits review-position attributes for metadata, so selection cannot insert invisible review marks
inside it. Body positions still refer to the original source, including CRLF offsets; edits remain
source splices and never serialize the YAML.

Behavior checks live in `tests/frontmatter.test.tsx`.
