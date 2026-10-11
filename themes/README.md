# mastermind design system

> Swiss International, in service of reading. The token NAMES are the schema every theme satisfies; components reference `var(--*)` only — no hardcoded values outside themes/*/tokens.css. **Grid** (light) is the reference theme.

## Tokens (Grid, the reference)

- Surfaces: `--color-bg #FCFCFA` (off-white paper), `--color-bg-elevated #F2F2EF` (chrome: top bar, navigator, panels — a hair cooler than paper), hairline `--color-border #E2E1DB`.
- Text: `--color-text #141414`, muted `#66665F` (AA at 11px metadata), faint `#9A968C` (**decorative/placeholders only** — below AA for text).
- Accent family (**chrome only** — CTA / active / focus, never document ink): `--color-accent #E5241B` (Swiss red), text-safe `--color-accent-dim #C01A12` (AA on bg), wash `--color-accent-surface`, CTA = red pill with white ink. Per theme: Nacht = electric blue, Sepia = ochre (ink-pill CTA).
- `--focus-ring`: ink on light themes, the accent on Nacht. `--color-selection`: neutral ink wash — selected text must not read as an insertion.
- Inversion family (the dark-band device — the selection toolbar): `--color-invert-bg #141414` etc. (light themes invert to dark; Nacht inverts to light).
- Review semantics: `--review-insert-*` (green), `--review-delete-*` (brick, kept browner than the accent red), `--review-highlight-*` (gold), `--review-comment-anchor` (blue dotted underline; **violet on Nacht** so it doesn't collide with the blue accent), `--review-comment-active-bg`. Marks are the only color in the document; the accent stays in the chrome.
- Code color (the one sanctioned exception to "marks own document color"): **off by default**. When the user opts in, fenced-block syntax tokens paint via runtime `--code-*` vars — schemes **Soft** / **Vivid** / **Warm**, each carrying light+dark palettes selected by the active theme's appearance. Like fonts, this is an app-level user preference (`src/ui/theme/codeThemes.ts`), not per-theme `tokens.css`; the picker lives under **Code font** in settings.

## Typography

- Heading and body fonts come from a user-selectable **font preset** in
  [`src/shared/fonts.ts`](../src/shared/fonts.ts). Presets override `--font-display`, `--font-body`,
  heading weight, and letter spacing across themes. The registry owns the available presets and
  their families; [`src/ui/theme/fonts.ts`](../src/ui/theme/fonts.ts) supplies local assets and
  fallback stacks.
- Default display (Grid): weight 800, line-height ~1.08, sentence case (the Swiss voice is weight + tight tracking, not caps), h1–h3.
- Body: 16px base (`--font-size-body`, user-adjustable), line-height 1.6 for long-form; don't go below 14px (`--font-size-sm`); micro = 11px for labels only.
- Mono: also user-selectable (`--font-mono`) — **Geist Mono** (default), JetBrains Mono, Spline Sans Mono, Ubuntu Sans Mono — for filenames, code, CriticMarkup source.
- Letterspacing: tight negative on display (−0.02em); +0.08em on the small mono eyebrow labels (`.settings-body h4`, `.ws-section-label`) — the one place ALL-CAPS remains. Buttons, toggles, toolbar verbs, and panel titles read in sentence case.

## Shape & layout

- Radius (generous on purpose — the interface should feel friendly, not clinical): `--radius-xs` 4px (inline marks, code, checkboxes), `--radius-md` 12px (cards, banners, inputs, menus), `--radius-lg` 20px (large floating panels: slide-over, modal, proposals, the navigator's right edge), `--radius-full` for pills (the CTA, ghost buttons, the segmented control) and circular elements.
- Reading measure: `--content-max-width` 46rem (~736px), centered. Right margin rail for comment cards.
- Spacing scale: 4px base, steps ×1,2,3,4,6,8,12,16,24.

## Iconography

- Tiny stroke SVGs on currentColor (src/ui/icons.tsx), 1.5px strokes. Never emoji or dingbat glyphs in chrome.

## Component treatments

- Document controls: elevated surface with a hairline border and filename in mono sm.
  Responsive placement and panel behavior live in [the layout contract](../src/ui/app/layout.md).
- Secondary/ghost buttons + view-mode toggle: pill shape, muted ink, sentence case; the active segment gains text color + elevated fill. Each mode segment carries a glyph (eye / pencil / code).
- Selection toolbar: the dark band device miniaturized (invert-bg surface, invert-text ink).
- Focus ring: 2px `--focus-ring`, offset 2px — ink on the light themes, the accent on Nacht.
- Optional film-grain overlay (SVG feTurbulence, desaturated): per-theme base opacity (~0.12 on Grid) scaled by a user **intensity** (off / low / medium / high) × **texture** (fine / soft / coarse). Off by default on every theme.

## Themes

A theme is `themes/<id>/theme.json` plus `tokens.css`; the token names above are the contract.
Each manifest declares its appearance and grain defaults. Bundled font faces live in `themes/fonts/`
and `themes/grid/fonts/`; the [asset registry](../src/ui/theme/fonts.ts) declares their local URLs.
Cross-theme preferences for font preset, code font, and code color scheme set token values at
runtime from their registries rather than any one theme's `tokens.css`.
