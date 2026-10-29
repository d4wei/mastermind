# mastermind design system

The theme layer owns colors, typography, spacing, shape, and motion. Components consume semantic
CSS variables. Review marks are the only color in document prose; code colors are an opt-in
exception. Navigation stays neutral so the document remains the focus.

## Ownership

Each `themes/<id>/tokens.css` declares its palette and imports [common.css](common.css). The shared
sheet owns geometry, defaults, derived surfaces, review-color relationships, shadows, and print
colors. Palette files override it without copying those declarations. Add a new token only when
its role cannot be expressed by an existing one.

`theme.json` contains the display name; the directory supplies the ID. [discovery.ts](discovery.ts)
reads preview swatches from the palette's background, muted text, and accent. It reads native
appearance from CSS `color-scheme`. These declarations must be literal values so discovery does
not need a browser or a second palette. Do not maintain swatch or appearance copies in JSON.
Discovery also defines the files the reviewer serves in development and ships: the tree without
its TypeScript sources and Markdown docs.

The [font registry](../ui/theme/fontRegistry.ts) owns font presets, and the
[asset registry](../ui/theme/fonts.ts) owns their local files and fallback stacks. Code fonts and
[code colors](../ui/theme/codeThemes.ts) are independent preferences. Their runtime overrides use
the same CSS variables as the theme defaults.

## Color roles

- **Primary actions:** `--color-accent` with `--color-on-accent`. Explicit accent hover and pressed
  colors preserve label contrast. Dialog confirmation, comment and suggestion submission, reply
  submission, and the home Open Markdown files button share this treatment.
- **Discussion:** `--review-comment-anchor` derives from the text-safe `--color-accent-text`.
  Passage underlines, author markers, and the selected card border share the theme's accent family;
  `--review-comment-active-bg` supplies a faint matching wash. Comment prose stays ordinary ink.
- **Other review marks:** insertion green, deletion brick, and highlight gold retain independent
  semantic roles. Dotted underlines, strikethrough, labels, and card linkage distinguish meaning
  even when a theme accent resembles a review color.
- **Navigation:** Open, Markdown, Comments, More, file tabs, and secondary actions use neutral ink
  and surfaces. The current outline tick uses the text-safe accent. Find matches and its Match case
  control use neutral emphasis, independent of review colors. The current match uses a darker fill
  without an additional underline or outline.
- **Selection and focus:** neutral selection fill and a neutral keyboard focus ring remain separate
  from review colors. Focus never substitutes for a selected state.
- **Document content:** ordinary links retain underlines and neutral ink; task checkboxes are
  neutral. Code colors are off by default. Their enabled palettes follow the theme's light/dark
  appearance and are calibrated against the elevated code-block surface.
- **Recovery:** neutral surfaces, warning symbols, and explicit labels communicate status. Primary
  recovery actions use the same button contract; application errors do not borrow deletion red.

Text, muted text, and faint decorative ink have separate roles. Faint ink is for decoration and
placeholders, not required reading. Inverted surfaces provide the selection toolbar's dark band
on light themes and light band on dark themes. Primary buttons retain their own paired colors
inside that band.

Ordinary hover and pressed surfaces mix neutral ink into the elevated background. Selected controls
retain their selection treatment; disabled controls do not react. Hover never moves or resizes a
control. Comment-card hover changes the neutral border without resembling the selected discussion.
Complete shadow tokens supply panel and popover elevation.

## Typography and layout

Font presets override reading fonts, heading weight, and letter spacing. Markdown headings use
body-relative sizes; shared block, heading, and list gaps establish the reading rhythm. All
document-body text sizes from `--font-size-body` (`--md-font-size-sm` or `em`) so the font size
setting scales it, while application chrome keeps the fixed `--font-size-sm/xs/micro` rem tokens.
Comment cards use the system UI font independently of reading preferences. The home wordmark uses a
fixed monospace stack and line height that preserve its horizontal slit.

Controls and panel labels use sentence case. Letter-spaced uppercase is reserved for small section
labels. Corner roles are shared across palettes:

- `--radius-xs`: inline marks, inline code, checkboxes, and compact inset controls.
- `--radius-md`: buttons, inputs, file tabs, theme choices, and tooltips.
- `--radius-lg`: cards, code blocks, callouts, menus, notifications, and panels.
- `--radius-full`: scrollbar thumbs. Outline and review-position ticks retain square ends.

Chrome uses the Radix icon family in [icons.tsx](../ui/icons.tsx), with matching custom review
strokes. Shared icon dimensions normalize document controls; the enclosed comment glyph uses a
slightly smaller optical bound. Selection changes the surface rather than the glyph's weight.
Single-icon buttons share `.btn-icon`: a square border box, centered glyph, no text-button padding,
and no flex shrinking. Document controls use `--control-size`; inset controls use
`--control-size-compact`. The outline tracker is a document-shaped navigation surface, not a single
icon button. Segmented selectors retain full-width rectangular choices without `.btn-icon`.
Letter-based symbols such as Find's Aa count as icons; their implementation as text does not change
their role.

Reading measure, margins, outline reservation, comment width, and gap are shared tokens. The
[layout contract](../ui/app/layout.md) owns centering, panel fallback, scrolling, and movement.
The [native appearance adapter](../ui/theme/appearance.md) synchronizes the window after stylesheet
load. The operating system owns window corners and traffic lights.

## Print and verification

Print uses a complete light palette from `common.css`, independent of the active screen theme.
Comments, insertions, deletions, and highlights remain distinct. Code syntax falls back to ordinary
text ink when printing.

[Theme contract tests](../tests/theme-token-consistency.test.ts) check consumed and orphan tokens,
shared palette shape, swatch derivation, primary labels in all enabled states, neutral focus on
adjacent surfaces, review text, and optional code colors. These palette calculations are not a
complete accessibility audit: native controls, compositing, interaction, and print layout also need
rendered checks. The [manual checklist](../tests/manual/review-interactions.md) covers those checks.
