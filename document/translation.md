# Prepared document translation

`prepareTranslation` projects the current source into an ordered narrative. Active review comments
are removed; highlight wrappers disappear while their quoted source remains. Recognized resolved
archive records and diagnostic archive ranges are omitted. Suggestions remain literal CriticMarkup.
Code, frontmatter, ordinary HTML, and other literal context blocks remain in the fingerprint but
are not offered for translation. Existing Markdown segmentation supplies paragraphs, headings,
and individual list items.

A projection has one SHA-256 fingerprint over its complete ordered block data. Block IDs are
ordinals within that projection, so identical paragraphs remain distinct. IDs do not authorize reuse
from another fingerprint: every preparation supplies the entire narrative for fresh translation.
This module does not read or reuse a translation cache. Segmentation carries raw source slices and
offsets; the complete projection supplies the only translation fingerprint.

CRLF and LF inputs share a narrative fingerprint. Each projected block also has source offsets
referring to the current original source, including its original line endings. Offset mapping
includes annotation delimiters at block boundaries, so feedback stays outside removed wrappers.
An adjacent archive is a separate boundary; point feedback stays before that archive. Adding or
resolving comments can move source offsets without invalidating the fingerprint. Positions are not
included in the fingerprint. Translated characters are not aligned with source characters.

`PreparedTranslation` is a versioned full-document artifact with source and target language codes,
the narrative fingerprint, and one `{id,text}` entry for each translatable block. Literal blocks are
supplied by the current source instead. `matchPreparedTranslation` accepts unknown input and rejects
wrong fields/types, missing or duplicate IDs, a different fingerprint, empty translations, and
changed active CriticMarkup suggestion structure. Suggestion text may translate; mark kinds and
order must remain, and so must the ordered literal delimiter tokens outside opaque source that pair
with no active mark, so prose that mentions a delimiter stays translatable. Suggestion discovery and
literal exclusions reuse the same plain Markdown tree for each exact block string; projected
narrative and original source keep separate trees. Each translation must retain one block of the
original outer kind, including Markdown heading/list syntax. Hidden HTML, fenced code, and
incompatible block splitting are rejected; ordinary inline formatting remains allowed. The helper
returns sanitized artifact data only after checking every block. Callers also check artifact
languages against the requested roles.

## Comments on translated selections

`translatedCommentEdit` accepts the expected fingerprint, one block ID, the exact selected quote,
its language, the author, and the authored comment. It re-prepares current source, checks the
fingerprint and block, and returns a single point-comment insertion at that source block's end; a
heading takes it at the end of its content, before a setext underline or closing `#` sequence. It
rejects literal blocks, unsafe author tags, invalid language codes, an insertion that would not be a
complete active comment, and one that would change its block's kind or heading depth. Callers must
still reject a response whose owning document or source revision changed while this asynchronous
preparation ran.

The comment's body is a single-line encoded record:

```text
translated-selection v1 {"language":"zh-CN","quote":"selected text","comment":"feedback"}
```

The ordinary Critic comment wrapper and author tag surround that body. JSON string values encode
braces, angle brackets, hyphens, and backticks as Unicode escapes. Native JSON escaping preserves
quotes, backslashes, control characters, and every original newline. Quoted or authored Critic
delimiters, HTML comment delimiters, and Markdown code ticks cannot corrupt the outer mark.
`parseTranslatedComment` decodes the record for display; unknown or malformed bodies remain ordinary
comment text. The decoded quote is exact. The authored comment is never translated by this module.
Point comments may become adjacent replies to an existing source discussion; the helper creates no
highlight and makes no cross-language selection claim.
