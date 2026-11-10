---
status: living
updated: 2026-11-09
exit: Ship per-language CJK faces, move the contract beside ui/theme/fonts.md, delete this.
---

# Japanese and Chinese glyph forms

One Unicode codepoint covers characters whose Japanese and Chinese shapes differ (直, 令, 骨, 辺),
and the font decides which shape appears. The app bundles Noto Serif SC and Noto Sans SC only, so
Japanese text, in the interface and in documents, shows Chinese forms. The interface language now
sets the document root's `lang`, which is the wrong signal for a document's body: a Chinese plan
read under a Japanese interface must keep Chinese forms. This design gives every block of rendered
text a language and lets the font stack follow it.

**Shipped so far.** Noto Sans JP and Noto Serif JP are bundled beside the SC pair. Every document
and block now resolves a language from frontmatter, a prepared translation's `sourceLang`, and
script detection, and the views carry it as `lang`, contract in the
[document language](../document/markdown/language.md) and the
[reading presentation](../ui/modes/reading/rendering.md). `CJK_STACKS` is style × language and the
document stylesheet swaps per-language tokens by `:lang()`, contract in the
[font presets](../ui/theme/fonts.md). Still to come: the `open --document-language` hint and the
fetched packs for Traditional Chinese, Hong Kong and Korean faces, which fall through to system
faces meanwhile.

## What is customary

HTML tags language on any element with `lang`, and CSS picks faces by it with `:lang()`; the
authors of a page, not the browser, are expected to name a face per language, because
`unicode-range` cannot separate the CJK languages, whose character sets overlap
([CSS Working Group thread](https://lists.w3.org/Archives/Public/public-css-archive/2018Oct/0199.html)).
Without a `lang`, browsers fall back to the user's language settings and the system's CJK font
order, which differed between engines for years
([W3C test](https://www.w3.org/International/tests/html-css/webfonts/results-auto),
[WebKit bug 10874](https://bugs.webkit.org/show_bug.cgi?id=10874)). Word tags language per run and
detects it as you type; Pandoc takes a document `lang` and span-level `lang` attributes. Code
editors do none of this: one font covers the buffer, and the reader picks a Japanese or Chinese
font to get the forms they want.

So the standard is per-element tagging with author-chosen faces, the untagged fallback is the
reader's preference, and the agent that wrote or translated a document knows its language better
than any guess.

## The language of a document and its blocks

The document's language comes from the first of these that answers:

1. **Frontmatter `lang`**, a BCP 47 code, the HTML attribute's name and what Pandoc and Quarto
   read, so a document written for them carries it already.
2. **What the agent says.** A prepared translation beside the document already carries its
   `sourceLang`, so a translated document is known without more; for an untranslated one, the
   agent can pass the language when it opens the file.
3. **Script detection** over the plain parse: the script most of the document's CJK blocks are
   in, `ja` for kana (hiragana, katakana, halfwidth katakana) and `ko` for hangul, so a quotation
   or two does not rename a Chinese document.
4. **`zh-CN`** when the document has Han characters and nothing above spoke; none otherwise, so
   the text inherits the root's interface language like the rest of the window.

Within the document, a block whose script contradicts the document's language is tagged for
itself: a kana block in a Chinese document is `ja`, a hangul block `ko`. Any other block takes the
document's language. Markdown has no block-level language syntax, so this is where detection does
its work; the agent speaks for the document, the script for the exceptions. In a translated view,
a translated block carries the prepared translation's target language and the original's blocks
keep their own. The interface keeps the root `lang` it has today. The language is a rendering
attribute only; it never touches the source, the translation input, Find, or selection mapping.

The same resolution serves any language: a document declared `fr` gets `lang="fr"` and the Latin
face, with the CJK stack unused; a `zh-TW` declaration selects the Traditional Chinese stack.

The agent names an untranslated document's language with `open --document-language CODE`, a
hint that is transient like `--language` and stored nowhere: frontmatter would be the agent
writing into the person's file, and a prepared translation exists only when one was asked for.

The Markdown source editor shows the whole document in one view and follows the document's
language only, as code editors customarily do; a kana block inside a Chinese document shows
Chinese forms there and Japanese ones in reading.

## Faces, and where they come from

Faces arrive in two steps today: `npm ci` installs the pinned `@fontsource-variable/*` packages,
and `npm run fonts:vendor` copies their woff2 slices into `themes/fonts/`, which is committed and
packaged into the app. At runtime the browser reads a slice only when a character needs it, since
every face is declared with the packages' `unicode-range` slices; a document in English loads no
CJK bytes. The app itself fetches nothing from the network. That rule guards what the app does
with documents and review data, not how its resources arrive: installing from the repository
already fetches every face, so a face for a language outside the interface languages can arrive
lazily, on the first document that needs it.

Bundle the faces of the interface languages, Latin, Simplified Chinese and Japanese, since the
interface needs them before any document opens: Noto Sans JP and Noto Serif JP join the SC pair,
about 12 MB in the clone and the app. The CJK part of each stack becomes a choice by language.
Every row leads with its Noto face, so one design carries every CJK language in each preset, and
system faces stand behind it only for the time a pack is absent:

| Language | Serif stack after the Latin face | Sans stack after the Latin face | Arrives |
| --- | --- | --- | --- |
| `zh` (Simplified) | Noto Serif SC, Songti SC, SimSun | Noto Sans SC, PingFang SC, Microsoft YaHei | bundled |
| `ja` | Noto Serif JP, Hiragino Mincho ProN, Yu Mincho | Noto Sans JP, Hiragino Sans, Yu Gothic | bundled |
| `zh-TW` | Noto Serif TC, Songti TC, PMingLiU | Noto Sans TC, PingFang TC, Microsoft JhengHei | pack |
| `zh-HK` | Noto Serif HK, Songti TC, PMingLiU | Noto Sans HK, PingFang HK, Microsoft JhengHei | pack |
| `ko` | Noto Serif KR, AppleMyungjo, Batang | Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic | pack |

A pack is fetched on first need. When a document resolves to a language whose pack is absent, the
app renders it in the system faces at once, fetches the pack (the pinned fontsource version from a
fixed URL, checked against a hash committed with the app), stores it in the user's cache directory
beside the launcher's own files, and loads it through the asset protocol; the next render uses it.
Offline, the system faces stand and a notice says the pack arrives when the network does.
Traditional Chinese and Korean system faces ship with macOS and Windows and with most Linux
desktops as Noto CJK, so the interim is readable there; where none is installed, Traditional
Chinese shows Simplified forms until the pack lands, as it does today. The request names a font
package, never a document: nothing about a file leaves the machine.

The app fetches packs itself, since a reader who opened a file from the picker has no agent to
ask. `DECISIONS.md` (2026-11-09) and the invariant in `AGENTS.md` allow exactly this: documents
and review data never leave the machine, and pinned, hash-checked resource packs are the one
network use. The native host makes the request, so the renderer's content security policy stays
closed to the network, and the README's "Local only" line is reworded when packs ship.

## Applying the stack

`CJK_STACKS` in `ui/theme/fontRegistry.ts` becomes style × language. `ThemeProvider` keeps
emitting `--font-display` and `--font-body` for the default language and adds the per-language
tokens (`--font-body-ja`, `--font-display-ja`, and the forms for the other rows); the document
stylesheet applies them with `:lang()` rules on rendered blocks, so components still reference
tokens only, as `themes/README.md` requires. The interface's own labels follow the root `lang`
through the same rules, so a Japanese interface shows Japanese forms in its chrome whatever the
document's language. Code stacks keep the sans CJK faces of the element's language.

## Checks

Resolution has unit tests for each tier and for block exceptions; the renderer's tests assert the
`lang` each block carries, including a translated view and a hinted open; the font tests cover the
stack per language; `tests/fonts-vendored.test.ts` keeps the new packages pinned. Pack fetching has
tests for a hash mismatch (rejected, nothing stored), an offline first need (system faces, the
notice, a retry when the network returns), and a cached pack found at startup. A manual check in
the app compares 直令骨辺 in a Japanese and a Chinese document under each interface language, and
a Traditional Chinese document on a Mac before and after its pack arrives.
