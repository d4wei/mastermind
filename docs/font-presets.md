---
status: living
updated: 2026-11-07
exit: A ruling picks the preset set; the registry, stacks, and settings ship it, and this design is deleted.
---

# Curated font presets

Settings offer seven display/body presets and four independent code fonts. Most presets pair a
geometric or display face with itself as body text, which reads poorly over a long plan, the code
font is chosen separately from the prose it sits beside, and no preset names a CJK face, so
Chinese text falls to whatever the WebKit default resolves. This design replaces the list with a
smaller set of complete pairings.

## What a preset is

A preset names every face the document needs so one choice reads coherently:

- **display** for headings, with its weight and tracking;
- **body** for prose, chosen for sustained reading rather than for the specimen;
- **code** for code spans, blocks, file names, and CriticMarkup source, paired by weight and width
  with the body face;
- **CJK fallback** stacks for body and display, so Chinese, Japanese, and Korean runs inside any
  preset render in a face matched to the preset's serif or sans character.

The code-color scheme stays an independent preference; it colors, it does not choose a face.

## CJK faces

No CJK face is bundled: one weight of Noto Sans CJK is larger than every other bundled asset
together, and the app ships no network. Presets instead declare system stacks and rely on the
platform: `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"` for sans
presets, and `"Songti SC", "Hiragino Mincho ProN", "SimSun", "Noto Serif CJK SC"` for serif presets,
each followed by the generic family. The Interface language's own labels use the same stacks.

## Selection rule

Body faces are chosen for comfort over hours of on-screen reading, and that rule outranks taste:
low to moderate stroke contrast, a generous x-height, open apertures, sturdy serifs that survive
dark mode, and even paragraph colour at 16 to 18 pixels. Headings may carry more personality, but
only where they help a reader find their place in a long document. Geometric and display faces
are excluded as body text.

## Recommended set

Three presets, all open-licensed and bundleable. Two share the Adobe Source family, whose Source
Han faces are the same designs as Noto CJK, so Latin, code, and Chinese come from one lineage.

| Preset | Headings | Body | Code | CJK stack leads with |
| --- | --- | --- | --- | --- |
| Serif (default) | Source Serif 4, 650 | Source Serif 4 | Source Code Pro, 500 | Songti SC, then Noto Serif SC |
| Sans | Source Sans 3, 700 | Source Sans 3 | Source Code Pro, 500 | PingFang SC, then Noto Sans SC |
| Hyperlegible | Atkinson Hyperlegible Next, 700 | Atkinson Hyperlegible Next | Atkinson Hyperlegible Mono | PingFang SC, then Noto Sans SC |

- **Serif** uses one face throughout. Sans headings were tried and set aside: over a day of
  reading, the unsurprising single family distracts least from the content. Source Serif 4's
  optical-size axis sharpens the headings and keeps text sizes sturdy.
- **Sans** serves readers who prefer sans text, with the same code face and proportions.
- **Hyperlegible** distinguishes every confusable letter and figure, for tired eyes, low vision,
  or small text. It is the deliberate offset from the maintainer's own serif preference.
- **Code at 500** matches Source Code Pro's colour to the body; at 400 inline spans look pale.

The serif body has two runners-up to settle by side-by-side reading before the ruling:
Charis SIL, the open-licence derivative of Bitstream Charter, which is plainer and sturdier; and
Literata, the e-book face, with a larger x-height and livelier italic.

Considered and set aside:

- Fraunces and Bricolage Grotesque: strong heading faces, but their character competes with long
  text; neither helps comfort.
- Geist and Geist Mono: tidy interface type, but grotesque enough to tire over long text.
- Fira Code: heavy beside text, and its ligatures disguise the source characters a reviewer
  needs to see.
- Recursive: its continuous axis between proportional and monospace suits the Markdown source
  mode more than reading; recorded as an idea, not part of this set.
- Charter and Iowan Old Style: benchmarks only; Apple's copies cannot be bundled.

Every face not named in the set leaves the registry, along with its bundled file. The new variable
files change the bundle size; record measured sizes when they land.

## Settings and preferences

The Font preset selector remains; the separate code font selector is removed, since the preset
names its code face. A saved `monoFont` is ignored and dropped on the next preference write; a saved
`fontPreset` naming a removed preset falls back to the default. The preference contract in
`desktop/src/setup.md` records the dropped key.

## Open points for the ruling

- Serif body: Source Serif 4, Charis SIL, or Literata.
- Whether two presets are enough, dropping Hyperlegible.
- Whether to bundle Noto Serif SC and Noto Sans SC for identical Chinese rendering on every
  platform, accepting their size, or keep system stacks.
- Whether a dark theme lowers body weight slightly to offset light text on a dark ground looking
  heavier; the variable faces allow it.
