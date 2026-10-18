---
status: living
updated: 2026-10-17
exit: Adopt the reviewed color roles in theme tokens and their consumers, then retire this audit.
---

# Theme color audit

The theme accent currently has little presence during ordinary reading. Comments deliberately use
another palette, while the open-file button, file tabs, document controls, and home wordmark are
neutral. Grid's filled primary buttons are already orange-red, but those buttons mainly appear
in onboarding and recovery dialogs. Sepia is the exception: its primary buttons are ink-colored.

**Recommendation:** use the selected theme's accent family for comments and primary actions,
retain neutral navigation controls, and keep insertion/deletion semantics distinct. Fix contrast,
native appearance, and token ownership at the same time. These color changes await review.
Film grain has been removed; theme-change fading remains.

## Where the accent goes today

| Surface | Current treatment |
| --- | --- |
| Current outline tick | Theme accent |
| Onboarding and recovery primary buttons | Theme accent; ink in Sepia |
| Reply submission | Text-safe accent; becomes neutral on hover |
| Comment or suggestion submission | CTA foreground on an inverted toolbar background |
| Document links and task checkboxes | Text-safe accent |
| Enabled search filters | Accent border |
| Comment passages and active cards | Separate comment palette |
| Open, Source, Comments, More, and file tabs | Neutral surfaces and ink |
| Home wordmark and open button | Neutral ink |
| Text selection and keyboard focus | Neutral selection wash and focus ring |

The [theme tokens](../themes/grid/tokens.css), [shared styles](../ui/app/app.css), and
[native styles](../ui/desktop/native.css) are the implementation sites. A black selection toolbar is
an inverted surface, not a black primary button. Not every clickable control should become a filled
accent button: the toolbar buttons were deliberately given equal, neutral weight.

### The two palettes behind each theme

The accent hexes below are the theme-picker swatches. Runtime colors use their OKLCH equivalents;
conversion to eight-bit sRGB can differ by one channel value.

| Theme | Advertised accent | Comment accent | Filled primary action |
| --- | --- | --- | --- |
| Grid | Orange-red `#e5241b` | Blue `#2f5fd0` | Orange-red, white label |
| Cobalt | Blue `#2f6df0` | Violet `#7c3aed` | Blue, white label |
| Rose | Rose `#d6336c` | Plum `#835471` | Rose, white label |
| Sepia | Ochre `#c8841c` | Brown `#846638` | Dark ink, paper label |
| Carbon | Blue-gray `#7c93b0` | Lavender `#b9a9d1` | Blue-gray, dark label |
| Mint | Green `#50fa7b` | Violet `#bd93f9` | Green, dark label |
| Slate | Teal `#2dd4bf` | Lavender `#aea1da` | Teal, dark label |

The surprise is encoded in the tokens, rather than a comment component failing to pick up the
current theme. Earlier choices kept comment color independent of the interface accent. This
recommendation replaces that rule while retaining separate semantic token names.

## Findings

1. **Primary-button hover reduces label contrast.** The shared rule blends the background toward
   its text color. Grid, Cobalt, and Rose fall below 4.5:1 on hover; Carbon falls below it while
   pressed. Give each theme explicit resting, hover, and pressed foreground/background pairs.
2. **Primary submission has three competing treatments.** Dialogs use filled buttons, replies use
   accent text, and selection composers borrow `--color-cta-text` without the matching background.
   The last pairing happens to remain legible today but has the wrong dependency. Use one compact
   primary-button treatment for Comment, Suggest change, and Reply submission. Keep Cancel and
   discussion-opening Reply controls neutral.
3. **Native appearance does not follow the selected theme.** The app synchronizes the WebView's
   background, but never calls Tauri's native theme setter. Inactive traffic lights are drawn by
   macOS, so CSS alone cannot correct their contrast. Synchronize the manifest's light/dark
   appearance with the native host, then verify active and inactive controls on every dark theme.
   The missing synchronization is confirmed in source; its contribution to the reported low
   contrast still needs a native before/after check. Do not replace the system traffic lights.
4. **Several shadows cannot render.** Selection toolbar, settings panel, tooltips, and search all
   reference `--shadow-strength`, which no theme defines. The settings panel's computed shadow is
   `none` in all seven themes. Put complete shadow tokens in the themes instead of multiplying
   hardcoded black by an absent variable.
5. **Document color rules and implementation disagree.** Links and task checkboxes use the accent,
   despite the invariant reserving document color for review marks and opt-in code highlighting.
   Restore neutral, underlined links and neutral task checkboxes. Comment marks may use the accent
   through their review tokens without violating that boundary.
6. **Print has a separate, incomplete palette inside component CSS.** It changes comments to the
   same green as insertions, but leaves other review tokens inherited from the active screen theme.
   Define a complete light print palette in the theme layer, with distinct review roles.
7. **Token ownership has gaps.** `--color-on-accent` has no UI consumer; CTA text duplicates it in
   six themes. `--color-accent-surface` is only a fallback behind the always-defined neutral
   selection token. Theme swatches repeat palette values in JSON and use a hardcoded gray border.
   Share primary foreground aliases, give the accent wash an explicit comment-state role, and
   derive swatches from the same palette authority rather than maintaining another set by hand.
8. **Some apparent accent uses are dead styles.** The custom settings checkbox, old translation
   toggle, and translation-failure badge have no current component consumers. Remove them rather
   than count them as visible uses. The unused failure badge also borrows deletion red for an error.
9. **The guide is stale.** It describes Mint under its internal ID as electric blue and gives two
   contradictory focus-ring rules. Revise it to describe semantic roles and link to token values.
   The neutral focus and control treatments themselves are intentional, not missing accent usage.
10. **Neutral focus is too faint on several surfaces.** Grid, Cobalt, Rose, and Sepia fall below
    3:1 on paper; Mint falls below it on elevated panels. Keep the neutral hue but choose stronger
    ring values, checking selected and hovered surfaces as well as the resting background.
11. **Opt-in code colors have substantial contrast gaps.** On the actual elevated code-block
    surface, 16 of the 21 token colors across Soft, Vivid, and Warm are below 4.5:1 in each light
    theme; Mint has nine, Carbon and Slate one each. The lowest ratio is 2.29:1 in Grid, Cobalt,
    and Rose. Recalibrate the light/dark code palettes separately from the application accent.

The scope covered all seven theme manifests and token files, UI stylesheets, component color
literals, the code-color registry, and the native appearance adapter. Contrast calculations cover
enabled button states, code text, and focus against resting surfaces. Review-color combinations,
print output, and native inactive controls still need rendered validation.

### Measured primary-button contrast

These ratios use the current token colors converted to sRGB and the actual 16% hover / 28% pressed
mixes. They are palette calculations, not a claim of a complete accessibility audit. Ordinary text
uses a 4.5:1 target under [WCAG contrast minimum][contrast]; identifying graphical states use the
separate [non-text contrast criterion][non-text].

| Theme | Rest | Hover | Pressed |
| --- | ---: | ---: | ---: |
| Grid | 4.56 | 3.85 | 3.25 |
| Cobalt | 4.61 | 3.54 | 2.89 |
| Rose | 4.62 | 3.72 | 3.09 |
| Sepia | 14.93 | 9.55 | 6.42 |
| Carbon | 6.14 | 4.63 | 3.70 |
| Mint | 12.42 | 9.09 | 7.01 |
| Slate | 9.20 | 6.86 | 5.39 |

Simply using the brightest accent everywhere would introduce other problems. Sepia's ochre is
only 2.63:1 against its paper background, so its fine comment underline needs a darker ochre from
the same family. Ochre with the existing dark on-accent label is 5.39:1, making a colored Sepia
primary button feasible. Grid's accent also needs its darker variant when used as small text.

## Proposed color roles

- **Primary action:** filled theme accent, with a paired contrasting label. Hover and pressed states
  stay in the same hue family and preserve text contrast. The home Open Markdown files button can
  use this treatment; the small toolbar open icon remains neutral alongside its peers.
- **Discussion:** theme-family underline and selected card border, with a faint matching passage
  wash. Use the text-safe accent for small author markers. Keep comment prose in ordinary ink.
- **Insertion / deletion / highlight:** retain their separate green, brick, and gold semantics.
  Grid comments remain recognizable by dotted underline and card linkage; deletions retain
  strikethrough. Mint comments need the same shape distinction from green insertions.
- **Navigation / selection / focus:** retain neutral controls, neutral selected text, and neutral
  focus rings. Current-section progress is the accent exception. Search toggles use the ordinary
  selected-control surface instead of introducing another accent-bordered state.
- **Recovery:** retain clear warning symbols, labels, and neutral notice surfaces. Do not borrow
  deletion or insertion colors for application status. Primary recovery actions follow the same
  button contract; destructive wording and confirmation remain explicit.
- **Native chrome:** synchronize light/dark appearance from the selected theme; the operating
  system continues to own traffic lights, menus, and their inactive treatment.

## Implementation and verification

First fix native appearance synchronization and the undefined shadows. Then apply the approved
color roles through theme tokens and shared button styles, removing dead aliases and rules.
Update the design guide and add checks for missing consumed tokens and contrast in enabled button
states. Runtime code-color and heading-layout variables need explicit treatment in that check.

Review a comparison in Grid, Sepia, and Mint before rolling the mapping across all themes. Include
hover, pressed, focused, disabled, active discussion, reply composition, and recovery states.
Verify code colors, print output, and inactive native controls separately. Run the full test suite,
both TypeScript configurations, and the native build before updating the running app.

[contrast]: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
[non-text]: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
