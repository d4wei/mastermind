# Document metadata

`Frontmatter.tsx` displays a YAML frontmatter node as read-only property rows when its contents are
a simple mapping. It uses the exact-pinned [`yaml` parser](https://eemeli.org/yaml/), whose document
API exposes errors, warnings, scalar nodes, tags, anchors, and source spelling without converting
the document into a JavaScript object. No aliases are expanded, and no YAML is serialized or saved.

Rows retain pair order. String keys and values use decoded text; other scalars retain their source
spelling so large integers, null forms, and numeric notation are not coerced for display. React
escapes every value. A YAML disclosure retains the literal source, including comments. These rows
are a reading aid, not a metadata editor; Markdown mode remains the editing surface.

Non-mappings, empty mappings, nested structures, nonstring or empty keys, merge keys, anchors, tags,
explicit directives, parse errors, and warnings fall back to literal YAML. Large metadata also
stays literal to bound additional parsing work on the render path. The limit belongs to the
constant in `Frontmatter.tsx`; it does not limit opening, editing, or saving the file.

Neither properties nor their source disclosure receive source-position attributes. They remain
outside inline review selection, while body nodes retain their original offsets. Source bytes,
line endings, translation context, and CriticMarkup exclusion still come from the shared Markdown
parser. `tests/frontmatter.test.tsx` checks display fallbacks, inert HTML, selection exclusion, and
exact body splices under LF and CRLF.
