# Document language

[language.ts](language.ts) names the language of a document and of the blocks whose script
contradicts it, so the reading view can tag them with `lang` and the font stack can follow; the
[font contract](../../ui/theme/fonts.md) says what each language selects. It reads the plain parse
the caller already holds and never parses again.

`scanScripts` walks the top-level blocks and the items of top-level lists, the units translation
segments by, once over their source ranges. It records whether the document holds kana (hiragana,
katakana, halfwidth katakana), hangul, or Han, and which blocks hold kana or hangul, since only
those can be exceptions. The katakana middle dot implies nothing, since Chinese text uses it too.
Review comments are skipped: they are in their reviewer's language, and translation drops them too.
A `{>>` without its `<<}` in the same block ends skipping for that block, which keeps the scan
linear. The frontmatter's top-level `lang` key is read with a line match, not a YAML parser.

`resolveLanguages` combines a scan with a supplied language. The document's language is the first
of:

1. the frontmatter's `lang`, when it is a well-formed BCP 47 tag;
2. the supplied language, when well-formed: what the agent or a prepared translation's
   `sourceLang` says;
3. `ja` when any block has kana, `ko` when any has hangul;
4. `zh-CN` when the document has Han;
5. none, so the view inherits the interface language.

A kana block in a document whose language is not Japanese is `ja`; a hangul block without kana in
a document whose language is not Korean is `ko`; every other block takes the document's language
and is not listed. Blocks are keyed by their source start offset, which the reading tree and the
translation projection share. Tags are canonicalized through `Intl.getCanonicalLocales`, so
`zh-cn` reads as `zh-CN` and `en_US` is rejected.

The result is a rendering attribute only: it never touches the source, offsets, the translation
input or fingerprint, Find's indexed text, or selection mapping.

`tests/document-language.test.ts` checks each tier, the exceptions, and a large document;
`tests/document-language-rendering.test.tsx` checks what the views carry.
