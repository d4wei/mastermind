# Bundled fonts

The faces of the [font presets](../../ui/theme/fontRegistry.ts) ship here, with the CJK faces of the
interface languages, Simplified Chinese and Japanese; the faces of the other CJK languages arrive as
resource packs. Everything in this directory except this file is generated and git-ignored: the
exact-pinned `@fontsource-variable/*` devDependencies in [package.json](../../package.json), which
`npm ci` installs, are the source. [vendor-fonts.mts](../../tools/fonts/vendor-fonts.mts) copies each
bundled package's variable woff2 slices and its licence as `OFL.txt`, and writes `faces.css`, which
stamps each family's package version and keeps the package's `unicode-range` slices, so a document
loads only the slices its characters need. To change what ships, change the family list in the
script; the packs follow the CJK stacks of the font registry.

The script runs after `npm ci` as the `postinstall` step, and again, doing nothing when the
directory is already current for the installed packages, before the tests, the Vite build and dev
server, and the session benchmark; `npm run dev` starts the dev server before the desktop crate
builds, and `npm run fonts:vendor` runs the script by hand. A run rewrites only the files that
differ and removes stale ones last, so a dev server or build reading the directory meanwhile sees
whole files. The desktop crate compiles in the pack manifest and stops with an error naming that
command when it is missing.
`tests/fonts-vendored.test.ts` checks the generator's output against the installed packages and
the lockfile, without the network.

## Resource packs

Noto Serif and Sans TC, HK, and KR are packs: their font files are never committed or bundled, and
the desktop host fetches each one the first time a document needs it, as the
[pack fetcher](../../desktop/src/font_packs.md) describes. The script writes, under `packs/`, one
sheet per pack, `@font-face` rules with the package's `unicode-range` slices whose URLs are bare
file names the reviewer resolves to the pack cache, and `packs/manifest.json`, one
entry per pack: the family, the package and exact version (the version line the bundled Noto
families pin), the registry tarball address and the registry's `sha512` integrity, both read from
`package-lock.json`, the sheet, and the font files to keep from the tarball. The pack packages are
devDependencies only so that generation and its test run offline; `npm ci` checks the same hash on
install.

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

Every family is licensed under the SIL Open Font License 1.1; each directory's `OFL.txt`, the
package's `LICENSE`, carries the copyright notice and licence text, and ships beside the fonts in the
app bundle.
