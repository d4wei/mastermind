# Font presets

A font preset in [fontRegistry.ts](fontRegistry.ts) names every face the document needs, so one
choice reads coherently:

- **display** for headings, with its weight and letter spacing;
- **body** for prose;
- **code** for code spans, blocks, the Markdown source, and CriticMarkup source, with its own
  weight so its colour matches the body;
- a **CJK style**, serif or sans, choosing the CJK faces that follow the Latin face in the
  display and body stacks.

The code-color scheme stays an independent preference; it colors, it does not choose a face. There
is no separate code font.

## Selection rule

Body faces are chosen for comfort over hours of on-screen reading, and that rule outranks taste:
low to moderate stroke contrast, a generous x-height, open apertures, sturdy serifs, and even
paragraph colour at 16 to 18 pixels. Headings may carry more personality only where it helps a
reader find their place in a long document. Geometric and display faces are excluded as body text.
A family with italics ships them, and Source Serif 4 keeps its optical-size axis, which the default
`font-optical-sizing: auto` applies to headings.

## CJK stacks by language

One codepoint covers characters whose Japanese and Chinese shapes differ, and the face decides
which shape appears, so the CJK part of each stack follows the language of the text. Each display
and body stack is the Latin face, then the CJK faces of the preset's style and the text's language,
then the generic family. `CJK_STACKS` holds the lists, style × language; every row leads with its
Noto face, then system faces for when that face is not bundled or a slice cannot load:

| Language | `:lang()` | Leading faces | Bundled |
| --- | --- | --- | --- |
| `zh`, the default | any other language, or none | Noto Serif SC, Noto Sans SC | yes |
| `ja` | `ja` | Noto Serif JP, Noto Sans JP | yes |
| `zh-TW` | `zh-TW`, `zh-Hant` | Noto Serif TC, Noto Sans TC | pack |
| `zh-HK` | `zh-HK` | Noto Serif HK, Noto Sans HK | pack |
| `ko` | `ko` | Noto Serif KR, Noto Sans KR | pack |

`BUNDLED_CJK_LANGUAGES` names the bundled rows, the interface languages' faces, which the window
needs before any document opens. The faces of the other rows are resource packs, fetched the first
time a document needs them, as [resource packs](#resource-packs) describes. Code takes system
monospace faces after its bundled face, so Latin code stays monospace if that face cannot load,
then the sans CJK faces of its language in every preset. The Noto faces ship as the packages'
`unicode-range` slices, so a document loads only the slices its characters need; the
[bundled fonts](../../themes/fonts/README.md) describe the files and their provenance.

`--font-display`, `--font-body`, and `--font-mono` carry the default language's stacks, and
`--font-{display,body,mono}-{zh,ja,zh-tw,zh-hk,ko}` carry each language's. The `:lang()` rules in
`ui/app/app.css` reset the three base tokens to the default row on each document view root (the
reading article, the translated view, the source editor) and on each element inside it that
carries `lang`, then to the row its language matches. Components keep referencing the base tokens.
A root without `lang` matches the interface language it inherits from the document element. The
[document language](../../document/markdown/language.md) says where a document's `lang` comes from.

## Resource packs

[fontPacks.ts](fontPacks.ts) decides when a pack is needed. A rendered document needs a pack when
the language of the document, of one of its tagged blocks, or of the translation it shows selects a
pack row through the `:lang()` rules above (`zh-TW` and `zh-Hant`, `zh-HK`, `ko`; a tag such as
`zh-Hant-HK` that can select either Traditional row needs both), and the active preset's CJK style
names that row's leading face. The view asks for the family of the style in use, and for the other
style's when the preset changes. Code's sans CJK faces are not requested under a serif preset; they
fall through to the system sans faces.

Each pack is requested once per launch, by name, from the desktop host, which downloads, checks,
and caches it as the [pack fetcher](../../desktop/src/font_packs.md) describes; a pack an earlier
launch cached is answered at once. Its sheet, generated beside the bundled one as the
[bundled fonts](../../themes/fonts/README.md#resource-packs) say, is read from
`/themes/fonts/packs/`, its bare file names are resolved to the cache through the asset protocol,
and it is installed as a `<style>` element. The faces keep the package's `unicode-range` slices, so
the webview reads a slice only when a character needs it, as with the bundled faces. Only the asset
protocol's origins join `font-src`; the renderer's `connect-src` stays closed to the network.

While a pack is absent, the text renders at once in the system faces listed after the Noto face in
its row. When the pack arrives, the new faces apply to the text already shown, with no reload. When
it cannot arrive, offline or refused, the system faces stand, and one transient notice per language
says its faces will arrive when the network does. The pack is requested again on the next need
after the webview reports the network back (`online`), or at the next launch; nothing retries on a
timer. Only a host with `fontPack`, the desktop host, fetches anything: the tests' hosts have none.

Interface chrome uses `--font-ui`, the system face (`system-ui`), not these stacks; the system picks
its CJK face from the document element's `lang`, which follows the interface language.

## Body weight on dark themes

Light text on a dark ground reads heavier than the same text on paper, so each preset names a lower
document body weight for themes whose appearance is dark; light themes keep 400. The values came
from matching each preset's dark rendering to its light one by eye on a desktop display. Headings,
bold text, code, and the interface keep their weights.

## Defaults and preferences

The first preset is the default, and the base tokens in `themes/common.css` (`--font-display`,
`--font-body`, `--font-mono` and their per-language forms, `--weight-body`, `--weight-bold`,
`--ls-heading`, `--weight-code`) match it, so the document renders identically before preferences
load. [ThemeProvider.tsx](ThemeProvider.tsx) links the bundled `@font-face` sheet once and
overrides those tokens from the chosen preset; `fontFamilyTokens` lists the family tokens.

A saved `fontPreset` that names no current preset reads as the default without rewriting the file.
The retired `monoFont` key is not read; the native host drops it from the next preference write
([setup contract](../../desktop/src/setup.md)).

`tests/fonts-consistency.test.ts`, `tests/fonts-vendored.test.ts`, and `tests/font-packs.test.tsx`
check these rules.
