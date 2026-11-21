import fs from 'node:fs/promises'
import path from 'node:path'
import postcss from 'postcss'

/** One family: the pinned package it comes from and the package sheets naming its faces. */
interface VendoredFamily {
  family: string
  pkg: string
  sheets: string[]
}

/**
 * Every family the font presets name, and the leading faces of the bundled CJK stacks in
 * `ui/theme/fontRegistry.ts`. Source Serif 4 takes the optical-size sheets so headings get display
 * optics; the others take their weight axis.
 */
export const VENDORED_FAMILIES: VendoredFamily[] = [
  { family: 'Source Serif 4', pkg: '@fontsource-variable/source-serif-4', sheets: ['opsz.css', 'opsz-italic.css'] },
  { family: 'Source Sans 3', pkg: '@fontsource-variable/source-sans-3', sheets: ['wght.css', 'wght-italic.css'] },
  { family: 'Source Code Pro', pkg: '@fontsource-variable/source-code-pro', sheets: ['wght.css', 'wght-italic.css'] },
  { family: 'Atkinson Hyperlegible Next', pkg: '@fontsource-variable/atkinson-hyperlegible-next', sheets: ['wght.css', 'wght-italic.css'] },
  { family: 'Atkinson Hyperlegible Mono', pkg: '@fontsource-variable/atkinson-hyperlegible-mono', sheets: ['wght.css', 'wght-italic.css'] },
  { family: 'Noto Serif SC', pkg: '@fontsource-variable/noto-serif-sc', sheets: ['wght.css'] },
  { family: 'Noto Sans SC', pkg: '@fontsource-variable/noto-sans-sc', sheets: ['wght.css'] },
  { family: 'Noto Serif JP', pkg: '@fontsource-variable/noto-serif-jp', sheets: ['wght.css'] },
  { family: 'Noto Sans JP', pkg: '@fontsource-variable/noto-sans-jp', sheets: ['wght.css'] },
]

/**
 * The leading faces of the CJK stacks in `ui/theme/fontRegistry.ts` that are not bundled: resource
 * packs the desktop host fetches on first need. Only their sheets and manifest entries are
 * generated; the pinned devDependencies supply the sheets and the lockfile supplies the address
 * and hash, so generating needs no network.
 */
export const PACK_FAMILIES: VendoredFamily[] = [
  { family: 'Noto Serif TC', pkg: '@fontsource-variable/noto-serif-tc', sheets: ['wght.css'] },
  { family: 'Noto Sans TC', pkg: '@fontsource-variable/noto-sans-tc', sheets: ['wght.css'] },
  { family: 'Noto Serif HK', pkg: '@fontsource-variable/noto-serif-hk', sheets: ['wght.css'] },
  { family: 'Noto Sans HK', pkg: '@fontsource-variable/noto-sans-hk', sheets: ['wght.css'] },
  { family: 'Noto Serif KR', pkg: '@fontsource-variable/noto-serif-kr', sheets: ['wght.css'] },
  { family: 'Noto Sans KR', pkg: '@fontsource-variable/noto-sans-kr', sheets: ['wght.css'] },
]

/** The stylesheet the reviewer loads, relative to the vendored fonts directory. */
export const FACES_SHEET = 'faces.css'
/** The directory of pack sheets and their manifest, relative to the vendored fonts directory. */
export const PACKS_DIR = 'packs'
export const PACK_MANIFEST = 'manifest.json'
/** The files of the fonts directory the generator does not own; the rest is git-ignored. */
const HAND_WRITTEN = new Set(['README.md'])

/**
 * One fetchable pack, named by its package's directory name. The native host downloads `url`,
 * checks it against `integrity` before storing anything, and keeps only `files`, which `sheet`
 * declares by bare file name for the renderer to resolve.
 */
export interface PackEntry {
  family: string
  package: string
  version: string
  url: string
  /** The registry's Subresource Integrity string for the tarball: `sha512-` and base64. */
  integrity: string
  sheet: string
  files: string[]
}

export interface PackManifest {
  packs: Record<string, PackEntry>
}

export interface VendoredFonts {
  /** Output path relative to the fonts directory → absolute source path in the package. */
  files: Map<string, string>
  css: string
  /** Pack sheet path relative to the fonts directory → its text. */
  packSheets: Map<string, string>
  manifest: string
}

const FACE_PROPS = ['font-style', 'font-weight', 'font-display', 'unicode-range'] as const

/** The package's version and one `@font-face` block per face of its sheets, sources in package order. */
async function familyFaces(nodeModules: string, { family, pkg, sheets }: VendoredFamily, url: (source: string) => string) {
  const root = path.join(nodeModules, pkg)
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { version: string }
  const blocks: string[] = []
  const sources: string[] = []
  for (const sheet of sheets) {
    const parsed = postcss.parse(await fs.readFile(path.join(root, sheet), 'utf8'))
    parsed.walkAtRules('font-face', (rule) => {
      const decls = new Map<string, string>()
      rule.walkDecls((decl) => { decls.set(decl.prop, decl.value) })
      const source = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(decls.get('src') ?? '')?.[1]
      if (!source) throw new Error(`${pkg}/${sheet}: a face without a woff2 source`)
      sources.push(source)
      const lines = [
        `  font-family: '${family}';`,
        `  src: url('${url(source)}') format('woff2');`,
        ...FACE_PROPS.flatMap((prop) => (decls.has(prop) ? [`  ${prop}: ${decls.get(prop)};`] : [])),
      ]
      blocks.push(`@font-face {\n${lines.join('\n')}\n}`)
    })
  }
  return { root, version, blocks, sources }
}

interface LockEntry { version?: string; resolved?: string; integrity?: string }

/**
 * Reads the pinned packages and returns the files to vendor plus one stylesheet declaring every
 * bundled face under its plain family name, with each package's unicode-range slices kept intact;
 * and, for each pack, a sheet in the same form whose URLs are bare file names, with the manifest
 * entry the native host fetches it by. `lockfile` is the repository's `package-lock.json`.
 */
export async function vendoredFonts(nodeModules: string,
  lockfile = path.join(nodeModules, '..', 'package-lock.json')): Promise<VendoredFonts> {
  const files = new Map<string, string>()
  const blocks: string[] = []
  for (const vendored of VENDORED_FAMILIES) {
    const dir = path.basename(vendored.pkg)
    const faces = await familyFaces(nodeModules, vendored, (source) => `${dir}/${source}`)
    files.set(`${dir}/OFL.txt`, path.join(faces.root, 'LICENSE'))
    blocks.push(`/* ${vendored.family}: ${vendored.pkg}@${faces.version}, SIL Open Font License 1.1 (${dir}/OFL.txt) */`)
    blocks.push(...faces.blocks)
    for (const source of faces.sources) files.set(`${dir}/${source}`, path.join(faces.root, 'files', source))
  }
  const header = '/* Generated by tools/fonts/vendor-fonts.mts from the pinned packages named below; do not edit. */'

  const lock = JSON.parse(await fs.readFile(lockfile, 'utf8')) as { packages: Record<string, LockEntry> }
  const packSheets = new Map<string, string>()
  const manifest: PackManifest = { packs: {} }
  for (const pack of PACK_FAMILIES) {
    const name = path.basename(pack.pkg)
    const faces = await familyFaces(nodeModules, pack, (source) => source)
    const locked = lock.packages[`node_modules/${pack.pkg}`]
    if (locked?.version !== faces.version || !locked.resolved || !locked.integrity) {
      throw new Error(`${pack.pkg}: the lockfile does not pin the installed ${faces.version} with an address and hash`)
    }
    const sheet = `${name}.css`
    packSheets.set(`${PACKS_DIR}/${sheet}`, [
      `/* Generated by tools/fonts/vendor-fonts.mts; do not edit. ${pack.family}: ${pack.pkg}@${faces.version},`,
      '   SIL Open Font License 1.1. A resource pack: the desktop host fetches the files on first need,',
      '   and the reviewer resolves each bare file name to the pack cache. */',
      '',
      ...faces.blocks,
    ].join('\n') + '\n')
    manifest.packs[name] = { family: pack.family, package: pack.pkg, version: faces.version, url: locked.resolved,
      integrity: locked.integrity, sheet, files: faces.sources }
  }
  return { files, css: `${header}\n\n${blocks.join('\n')}\n`, packSheets,
    manifest: `${JSON.stringify(manifest, null, 2)}\n` }
}

/** Replaces the generated contents of `fontsDir` with the vendored set and the pack sheets. */
export async function writeVendoredFonts(nodeModules: string, fontsDir: string,
  generated?: VendoredFonts): Promise<void> {
  const { files, css, packSheets, manifest } = generated ?? await vendoredFonts(nodeModules)
  await fs.mkdir(fontsDir, { recursive: true })
  for (const entry of await fs.readdir(fontsDir)) {
    if (!HAND_WRITTEN.has(entry)) await fs.rm(path.join(fontsDir, entry), { recursive: true })
  }
  for (const [target, source] of files) {
    await fs.mkdir(path.dirname(path.join(fontsDir, target)), { recursive: true })
    await fs.copyFile(source, path.join(fontsDir, target))
  }
  await fs.writeFile(path.join(fontsDir, FACES_SHEET), css)
  await fs.mkdir(path.join(fontsDir, PACKS_DIR), { recursive: true })
  for (const [target, text] of packSheets) await fs.writeFile(path.join(fontsDir, target), text)
  await fs.writeFile(path.join(fontsDir, PACKS_DIR, PACK_MANIFEST), manifest)
}

async function readOrNull(file: string): Promise<string | null> {
  try { return await fs.readFile(file, 'utf8') } catch { return null }
}

/**
 * Whether `fontsDir` holds exactly what `generated` names: the same files, the same text for the
 * sheets and manifest, and each font file at its package file's size. The sheets stamp every
 * package version, so a new pin changes their text; sizes stand in for bytes to keep the check fast.
 */
export async function vendoredFontsCurrent(fontsDir: string, generated: VendoredFonts): Promise<boolean> {
  const { files, css, packSheets, manifest } = generated
  const texts = new Map<string, string>([[FACES_SHEET, css], ...packSheets, [`${PACKS_DIR}/${PACK_MANIFEST}`, manifest]])
  let present: string[]
  try {
    present = (await fs.readdir(fontsDir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(fontsDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
      .filter((rel) => !HAND_WRITTEN.has(rel))
  } catch {
    return false
  }
  if (present.length !== files.size + texts.size || present.some((rel) => !files.has(rel) && !texts.has(rel))) return false
  for (const [target, text] of texts) if (await readOrNull(path.join(fontsDir, target)) !== text) return false
  for (const [target, source] of files) {
    const [copy, original] = await Promise.all([fs.stat(path.join(fontsDir, target)), fs.stat(source)])
    if (copy.size !== original.size) return false
  }
  return true
}

/**
 * Generates `themes/fonts/` under `root` unless it is already current for the installed packages,
 * and reports which. Each entry point that reads the generated files calls it: the install script,
 * the test setup, the Vite build and dev server, and the session benchmark.
 */
export async function ensureVendoredFonts(root: string): Promise<'current' | 'generated'> {
  const nodeModules = path.join(root, 'node_modules')
  const fontsDir = path.join(root, 'themes/fonts')
  let generated: VendoredFonts
  try {
    generated = await vendoredFonts(nodeModules, path.join(root, 'package-lock.json'))
  } catch (error) {
    throw new Error(`Cannot read the pinned font packages; run \`npm ci\` in ${root}.`, { cause: error })
  }
  if (await vendoredFontsCurrent(fontsDir, generated)) return 'current'
  await writeVendoredFonts(nodeModules, fontsDir, generated)
  return 'generated'
}

if (import.meta.filename === process.argv[1]) {
  const outcome = await ensureVendoredFonts(path.resolve(import.meta.dirname, '../..'))
  console.log(outcome === 'current' ? 'themes/fonts is current.' : 'Generated themes/fonts from the pinned font packages.')
}
