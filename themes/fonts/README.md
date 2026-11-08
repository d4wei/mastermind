# Bundled fonts

Every face the [font presets](../../ui/theme/fontRegistry.ts) name ships here, since the app loads
nothing from the network. `npm run fonts:vendor` regenerates this directory, except this file, from
the exact-pinned `@fontsource-variable/*` devDependencies in [package.json](../../package.json):
it copies each package's variable woff2 slices and licence, and writes [faces.css](faces.css),
which stamps each family's package version and keeps the package's `unicode-range` slices, so a
document loads only the slices its characters need. Do not edit the generated files; change the
family list in [vendor-fonts.mts](../../tools/fonts/vendor-fonts.mts) and rerun it.
`tests/fonts-vendored.test.ts` checks the committed files against the installed packages.

| Directory | Family | Package | Axes, styles |
| --- | --- | --- | --- |
| `source-serif-4/` | Source Serif 4 | `@fontsource-variable/source-serif-4` | weight, optical size; roman, italic |
| `source-sans-3/` | Source Sans 3 | `@fontsource-variable/source-sans-3` | weight; roman, italic |
| `source-code-pro/` | Source Code Pro | `@fontsource-variable/source-code-pro` | weight; roman, italic |
| `atkinson-hyperlegible-next/` | Atkinson Hyperlegible Next | `@fontsource-variable/atkinson-hyperlegible-next` | weight; roman, italic |
| `atkinson-hyperlegible-mono/` | Atkinson Hyperlegible Mono | `@fontsource-variable/atkinson-hyperlegible-mono` | weight; roman, italic |
| `noto-serif-sc/` | Noto Serif SC | `@fontsource-variable/noto-serif-sc` | weight; roman |
| `noto-sans-sc/` | Noto Sans SC | `@fontsource-variable/noto-sans-sc` | weight; roman |

Every family is licensed under the SIL Open Font License 1.1; each directory's `OFL.txt` carries
the copyright notice and licence text, and ships beside the fonts in the app bundle.
