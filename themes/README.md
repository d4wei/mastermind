# mastermind design system

> Swiss International, in service of reading. The token NAMES are the schema every theme satisfies; components reference `var(--*)` only — no hardcoded values outside themes/*/tokens.css. **Grid** (light) is the reference theme.

## Tokens (Grid, the reference)

- Surfaces: `--color-bg #FCFCFA` (off-white paper), `--color-bg-elevated #F2F2EF` (chrome: top bar, navigator, panels — a hair cooler than paper), hairline `--color-border #E2E1DB`.
- Text: `--color-text #141414`, muted `#66665F` (AA at 11px metadata), faint `#9A968C` (**decorative/placeholders only** — below AA for text).
- Accent family (**chrome only** — CTA / active / focus, never document ink):
  `--color-accent #E5241B` (Swiss red), text-safe `--color-accent-dim #C01A12` (AA on bg),
  wash `--color-accent-surface`, CTA = red button with white ink. Per theme: Nacht = electric blue,
  Sepia = ochre with an ink-colored CTA.
- `--focus-ring`: neutral gray-10 in every theme. `--color-selection`: neutral ink wash — selected
  text must not read as an insertion.
- Inversion family (the dark-band device — the selection toolbar): `--color-invert-bg #141414` etc. (light themes invert to dark; Nacht inverts to light).
- Review semantics: `--review-insert-*` (green), `--review-delete-*` (brick, kept browner than the accent red), `--review-highlight-*` (gold), `--review-comment-anchor` (blue dotted underline; **violet on Nacht** so it doesn't collide with the blue accent), `--review-comment-active-bg`. Marks are the only color in the document; the accent stays in the chrome.
- Code color (the one sanctioned exception to "marks own document color"): **off by default**. When the user opts in, fenced-block syntax tokens paint via runtime `--code-*` vars — schemes **Soft** / **Vivid** / **Warm**, each carrying light+dark palettes selected by the active theme's appearance. Like fonts, this is an app-level user preference (`ui/theme/codeThemes.ts`), not per-theme `tokens.css`; the picker lives under **Code font** in settings.

## Typography

- Heading and body fonts come from a user-selectable **font preset** in
  [`ui/theme/fontRegistry.ts`](../ui/theme/fontRegistry.ts). Presets override `--font-display`, `--font-body`,
  heading weight, and letter spacing across themes. The registry owns the available presets and
  their families; [`ui/theme/fonts.ts`](../ui/theme/fonts.ts) supplies local assets and
  fallback stacks.
- Reading headings follow body-relative sizes (`--md-h1-size` through `--md-h6-size`) and the
  selected font preset. `--md-block-gap` gives prose blocks one shared gap; `--md-heading-gap`
  separates sections. `--md-list-gap` and `--md-list-indent` keep list rhythm consistent.
- Body: 16px base (`--font-size-body`, user-adjustable), line-height 1.6 for long-form; don't go below 14px (`--font-size-sm`); micro = 11px for labels only.
- Comment cards use `--font-ui`, a system sans-serif stack independent of the reading font preset.
- The home wordmark uses `--font-wordmark`, a fixed system monospace stack, so changing code fonts
  does not change the block glyphs. `--wordmark-line-height` preserves the horizontal slit.
- Mono: also user-selectable (`--font-mono`) — **Geist Mono** (default), JetBrains Mono, Spline Sans Mono, Ubuntu Sans Mono — for filenames, code, CriticMarkup source.
- Letterspacing: tight negative on display (−0.02em); +0.08em on the small mono eyebrow labels (`.settings-body h4`, `.ws-section-label`) — the one place ALL-CAPS remains. Buttons, toggles, toolbar verbs, and panel titles read in sentence case.

## Shape & layout

- Corner sizes live in every theme's `tokens.css` and stay the same across palettes:
  - `--radius-xs`: inline marks, inline code, checkboxes, and compact inset actions or rows.
  - `--radius-md`: buttons, inputs, file tabs, theme choices, and tooltips.
  - `--radius-lg`: cards, code blocks, callouts, menus, notifications, and floating panels.
  - `--radius-full`: scrollbar thumbs; outline and review-position ticks keep square ends.
- Controls use rounded rectangles. A control does not become a pill merely because it is a primary
  action or a segmented choice. Nested segmented buttons use the smaller inset radius.
- The native operating system owns window corners and traffic lights.
- `--color-dialog-backdrop` dims the document behind the single modal close decision.
- Reading measure: `--content-max-width` 46rem (~736px), centered. Right margin rail for comment cards.
- Spacing scale: 4px base, steps ×1,2,3,4,6,8,12,16,24.

## Iconography

- Chrome uses the Radix icon family in `ui/icons.tsx`; custom review glyphs use matching strokes.
- Open, Source, Comments, and More share button dimensions, neutral surfaces, borders, and ink.
  `--control-icon-size` sets their optical bounds; `--control-enclosed-icon-size` slightly reduces
  the enclosed comment glyph. Selection changes the surface, not the icon or border weight.

## Component treatments

- Document controls: compact icon buttons alongside the file tabs. Responsive placement and panel
  behavior live in [the layout contract](../ui/app/layout.md).
- Secondary buttons and segmented choices use muted ink and sentence case. Active segments gain
  text color and selection fill. The view-mode button shows the icon for the mode it opens.
- Selection toolbar: the dark band device miniaturized (invert-bg surface, invert-text ink).
- Focus ring: 2px `--focus-ring`, offset 2px — ink on the light themes, the accent on Nacht.

## Themes

A theme is `themes/<id>/theme.json` plus `tokens.css`; the token names above are the contract.
Each manifest declares its appearance and preview swatch. Bundled font faces live in `themes/fonts/`
and `themes/grid/fonts/`; the [asset registry](../ui/theme/fonts.ts) declares their local URLs.
Cross-theme preferences for font preset, code font, and code color scheme set token values at
runtime from their registries rather than any one theme's `tokens.css`.

## Interaction feedback

Ordinary buttons, file tabs, choices, and navigation rows use `--color-control-hover` for a neutral
hover surface and `--color-text` for stronger ink. Pressed controls use `--color-control-pressed`.
Each theme mixes text ink into its elevated surface for these tokens. Selected choices retain their separate fill on
hover; disabled controls do not react. Primary actions keep their accent treatment. Selection
toolbar actions use the inverted surface and matching text, including composer actions. Keyboard
focus retains its own ring.

Text links retain underlines, review marks retain semantic colors, and scrollbars retain their
track treatment. The document thumb uses `--document-scrollbar-size`, sits against the window edge,
and hides when neither scrolling nor pointing at that edge. Comment cards use a neutral border
change so hovering does not resemble the active anchored discussion. Hover changes do not move or resize controls.

## Reading group geometry and review palettes

`--reading-edge` reserves the outer margin, `--reading-outline` the visible outline strip,
`--reading-rail` the comment card width, and `--reading-gap` its distance from the document column.
`--reading-min-em` scales the minimum inline reading measure with the selected body font size.
The [layout contract](../ui/app/layout.md) owns centering, panel fallback, and movement.

Comment colors remain separate from insertion green and deletion brick. Sepia uses warm brown,
Rose muted plum, Grid blue, and Cobalt violet. The dark themes use violet with restrained saturation;
Carbon reduces its brightness relative to the original palette. Anchor underlines and selected card
borders share `--review-comment-anchor`; selected passage fill uses `--review-comment-active-bg`.
Application actions and outline progress retain the theme accent. Shape and labels carry review
meaning alongside color.
