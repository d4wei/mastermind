# Bundled fonts

The faces of the [font presets](../../ui/theme/fontRegistry.ts) ship here, with the CJK faces of the
interface languages, Simplified Chinese and Japanese; the faces of the other CJK languages arrive as
resource packs. `npm run fonts:vendor` regenerates this directory, except this file, from the
exact-pinned `@fontsource-variable/*` devDependencies in [package.json](../../package.json): it
copies each bundled package's variable woff2 slices and licence, and writes [faces.css](faces.css),
which stamps each family's package version and keeps the package's `unicode-range` slices, so a
document loads only the slices its characters need. Do not edit the generated files; change the
family lists in [vendor-fonts.mts](../../tools/fonts/vendor-fonts.mts) and rerun it.
`tests/fonts-vendored.test.ts` checks the committed files against the installed packages and the
lockfile, without the network.

## Resource packs

Noto Serif and Sans TC, HK, and KR are packs: their font files are never committed or bundled, and
the desktop host fetches each one the first time a document needs it, as the
[pack fetcher](../../desktop/src/font_packs.md) describes. The script writes, under `packs/`, one
sheet per pack, `@font-face` rules with the package's `unicode-range` slices whose URLs are bare
file names the reviewer resolves to the pack cache, and [manifest.json](packs/manifest.json), one
entry per pack: the family, the package and exact version (the version line the bundled Noto
families pin), the registry tarball address and the registry's `sha512` integrity, both read from
`package-lock.json`, the sheet, and the font files to keep from the tarball. The pack packages are
devDependencies only so that this regeneration and its test run offline; `npm ci` checks the same
hash on install.

| Directory | Family | Package | Axes, styles |
| --- | --- | --- | --- |
| `source-serif-4/` | Source Serif 4 | `@fontsource-variable/source-serif-4` | weight, optical size; roman, italic |
| `source-sans-3/` | Source Sans 3 | `@fontsource-variable/source-sans-3` | weight; roman, italic |
| `source-code-pro/` | Source Code Pro | `@fontsource-variable/source-code-pro` | weight; roman, italic |
| `atkinson-hyperlegible-next/` | Atkinson Hyperlegible Next | `@fontsource-variable/atkinson-hyperlegible-next` | weight; roman, italic |
| `atkinson-hyperlegible-mono/` | Atkinson Hyperlegible Mono | `@fontsource-variable/atkinson-hyperlegible-mono` | weight; roman, italic |
| `noto-serif-sc/` | Noto Serif SC | `@fontsource-variable/noto-serif-sc` | weight; roman |
| `noto-sans-sc/` | Noto Sans SC | `@fontsource-variable/noto-sans-sc` | weight; roman |
| `noto-serif-jp/` | Noto Serif JP | `@fontsource-variable/noto-serif-jp` | weight; roman |
| `noto-sans-jp/` | Noto Sans JP | `@fontsource-variable/noto-sans-jp` | weight; roman |

Every family is licensed under the SIL Open Font License 1.1; each directory's `OFL.txt` carries
the copyright notice and licence text, and ships beside the fonts in the app bundle.
