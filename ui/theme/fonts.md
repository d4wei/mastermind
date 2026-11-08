# Font presets

A font preset in [fontRegistry.ts](fontRegistry.ts) names every face the document needs, so one
choice reads coherently:

- **display** for headings, with its weight and letter spacing;
- **body** for prose;
- **code** for code spans, blocks, the Markdown source, and CriticMarkup source, with its own
  weight so its colour matches the body;
- a **CJK style**, serif or sans, choosing the Chinese faces that follow the Latin face in the
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

## CJK stacks

Each display and body stack is the Latin face, then the bundled Noto SC face matching the preset's
style, then system faces in case a bundled slice cannot load, then the generic family; `CJK_STACKS`
holds the lists. Code takes the sans CJK faces in every preset. Noto SC ships as the packages'
`unicode-range` slices, so a document loads only the slices its characters need; the
[bundled fonts](../../themes/fonts/README.md) describe the files and their provenance.

## Defaults and preferences

The first preset is the default, and the base tokens in `themes/common.css` (`--font-display`,
`--font-body`, `--font-mono`, `--weight-bold`, `--ls-heading`, `--weight-code`) match it, so the
document renders identically before preferences load. [ThemeProvider.tsx](ThemeProvider.tsx) links
the bundled `@font-face` sheet once and overrides those tokens from the chosen preset.

A saved `fontPreset` that names no current preset reads as the default without rewriting the file.
The retired `monoFont` key is not read; the native host drops it from the next preference write
([setup contract](../../desktop/src/setup.md)).

`tests/fonts-consistency.test.ts` and `tests/fonts-vendored.test.ts` check these rules.
