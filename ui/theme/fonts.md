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
| `zh-TW` | `zh-TW`, `zh-Hant` | Noto Serif TC, Noto Sans TC | no |
| `zh-HK` | `zh-HK` | Noto Serif HK, Noto Sans HK | no |
| `ko` | `ko` | Noto Serif KR, Noto Sans KR | no |

Faces not bundled fall through to the system faces after them until resource packs bring them
([CJK glyph forms](../../docs/cjk-glyph-forms.md)). Code takes system monospace faces after its
bundled face, so Latin code stays monospace if that face cannot load, then the sans CJK faces of
its language in every preset. The Noto faces ship as the packages' `unicode-range` slices, so a
document loads only the slices its characters need; the
[bundled fonts](../../themes/fonts/README.md) describe the files and their provenance.

`--font-display`, `--font-body`, and `--font-mono` carry the default language's stacks, and
`--font-{display,body,mono}-{zh,ja,zh-tw,zh-hk,ko}` carry each language's. The `:lang()` rules in
`ui/app/app.css` reset the three base tokens to the default row on each document view root (the
reading article, the translated view, the source editor) and on each element inside it that
carries `lang`, then to the row its language matches. Components keep referencing the base tokens.
A root without `lang` matches the interface language it inherits from the document element. The
[document language](../../document/markdown/language.md) says where a document's `lang` comes from.

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

`tests/fonts-consistency.test.ts` and `tests/fonts-vendored.test.ts` check these rules.
