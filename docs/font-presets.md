---
status: living
updated: 2026-10-29
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

## Recommended set

Four presets, each a deliberate pairing, built from faces already in `themes/fonts/`:

| Preset | Display | Body | Code | Character |
| --- | --- | --- | --- | --- |
| Schibsted (default) | Schibsted Grotesk 800 | Schibsted Grotesk | Geist Mono | The house grotesk; matches the base tokens. |
| Editorial | Bricolage Grotesque 700 | Lora | JetBrains Mono | Expressive headings over a serif built for screens. |
| Classic | Crimson Pro 600 | Crimson Pro | JetBrains Mono | A book serif throughout for long documents. |
| Geist | Geist 700 | Geist | Geist Mono | One family across prose and code. |

Dropped: Manrope and Outfit (geometric faces that tire as body text), Inter as a body-only face,
Spline Sans Mono and Ubuntu Sans Mono (no preset pairs with them). Their font files leave with them.

## Settings and preferences

The Font preset selector remains; the separate code font selector is removed, since the preset
names its code face. A saved `monoFont` is ignored and dropped on the next preference write; a saved
`fontPreset` naming a removed preset falls back to the default. The preference contract in
`desktop/src/setup.md` records the dropped key.

## Open points for the ruling

- Whether four is the right count, and whether Classic and Editorial both earn a place.
- Whether to add one bundled CJK face later for a consistent cross-platform rendering, accepting
  the size.
- Whether a preset may override the heading tracking per face, as the current registry allows, or
  tracking becomes a body-derived constant.
