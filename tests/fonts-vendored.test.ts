import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, utimesSync,
  writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import postcss from 'postcss'
import {
  FACES_SHEET, PACK_FAMILIES, PACK_MANIFEST, PACKS_DIR, VENDORED_FAMILIES, ensureVendoredFonts, vendoredFonts,
  vendoredFontsCurrent, writeVendoredFonts, type PackManifest, type VendoredFonts,
} from '../tools/fonts/vendor-fonts.mjs'

const nodeModules = path.resolve('node_modules')
const fontsDir = path.resolve('themes/fonts')

/** Every file under `dir`, relative and with forward slashes. */
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((rel) => statSync(path.join(dir, rel)).isFile())
    .map((rel) => rel.split(path.sep).join('/')).sort()
}

function faceUrls(css: string): { families: string[]; urls: string[] } {
  const families = new Set<string>()
  const urls: string[] = []
  postcss.parse(css).walkAtRules('font-face', (rule) => {
    rule.walkDecls('font-family', (decl) => { families.add(decl.value.replace(/^'|'$/g, '')) })
    rule.walkDecls('src', (decl) => { for (const [, url] of decl.value.matchAll(/url\('([^']+)'\)/g)) urls.push(url!) })
  })
  return { families: [...families], urls }
}

let generated: VendoredFonts
let outDir: string
beforeAll(async () => {
  generated = await vendoredFonts(nodeModules)
  outDir = mkdtempSync(path.join(tmpdir(), 'mm-fonts-'))
  await writeVendoredFonts(outDir, generated)
})
afterAll(() => { rmSync(outDir, { recursive: true, force: true }) })

describe('the font generator', () => {
  it('declares every bundled family, and only faces whose files it writes beside the sheet', () => {
    const { families, urls } = faceUrls(generated.css)
    expect(families).toEqual(VENDORED_FAMILIES.map(({ family }) => family))
    const written = tree(outDir)
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter((url) => !written.includes(url))).toEqual([])
    expect(written.filter((rel) => rel.endsWith('.woff2') && !urls.includes(rel))).toEqual([])
  })

  it('copies each package file byte for byte, with its licence', () => {
    for (const [target, source] of generated.files) {
      expect(readFileSync(path.join(outDir, target)).equals(readFileSync(source)), target).toBe(true)
    }
    for (const { pkg } of VENDORED_FAMILIES) {
      expect(generated.files.get(`${path.basename(pkg)}/OFL.txt`), pkg).toBe(path.join(nodeModules, pkg, 'LICENSE'))
    }
  })

  it('writes exactly its outputs, the same on every run', async () => {
    expect(tree(outDir)).toEqual([FACES_SHEET, ...generated.files.keys(), ...generated.packSheets.keys(),
      `${PACKS_DIR}/${PACK_MANIFEST}`].sort())
    const again = await vendoredFonts(nodeModules)
    expect(again.css).toBe(generated.css)
    expect(again.manifest).toBe(generated.manifest)
    expect([...again.packSheets]).toEqual([...generated.packSheets])
    expect([...again.files]).toEqual([...generated.files])
  })

  it('regenerates only when its output is missing, stale, or carries a stray file', async () => {
    expect(await vendoredFontsCurrent(outDir, generated)).toBe(true)
    const font = [...generated.files.keys()].find((target) => target.endsWith('.woff2'))!
    unlinkSync(path.join(outDir, font))
    expect(await vendoredFontsCurrent(outDir, generated)).toBe(false)
    await writeVendoredFonts(outDir, generated)
    writeFileSync(path.join(outDir, FACES_SHEET), '/* an older pin */')
    expect(await vendoredFontsCurrent(outDir, generated)).toBe(false)
    await writeVendoredFonts(outDir, generated)
    writeFileSync(path.join(outDir, 'retired.woff2'), '')
    expect(await vendoredFontsCurrent(outDir, generated)).toBe(false)
    await writeVendoredFonts(outDir, generated)
    expect(await vendoredFontsCurrent(outDir, generated)).toBe(true)
  })

  it('rewrites only what differs and removes strays last, leaving matching files untouched', async () => {
    const manifest = path.join(outDir, PACKS_DIR, PACK_MANIFEST)
    const [font] = [...generated.files.keys()].filter((target) => target.endsWith('.woff2'))
    const past = new Date('2020-01-01T00:00:00Z')
    utimesSync(manifest, past, past)
    utimesSync(path.join(outDir, font!), past, past)
    writeFileSync(path.join(outDir, FACES_SHEET), '/* an older pin */')
    mkdirSync(path.join(outDir, 'retired-family'))
    writeFileSync(path.join(outDir, 'retired-family/retired.woff2'), '')
    await writeVendoredFonts(outDir, generated)
    expect(statSync(manifest).mtimeMs).toBe(past.getTime())
    expect(statSync(path.join(outDir, font!)).mtimeMs).toBe(past.getTime())
    expect(readFileSync(path.join(outDir, FACES_SHEET), 'utf8')).toBe(generated.css)
    expect(existsSync(path.join(outDir, 'retired-family'))).toBe(false)
    expect(tree(outDir)).toEqual([FACES_SHEET, ...generated.files.keys(), ...generated.packSheets.keys(),
      `${PACKS_DIR}/${PACK_MANIFEST}`].sort())
  })

  it('keeps the working tree current, and git tracks only the hand-written readme', async () => {
    expect(await ensureVendoredFonts(path.resolve('.'))).toBe('current')
    const tracked = execFileSync('git', ['ls-files', '--', 'themes/fonts'], { encoding: 'utf8' }).trim().split('\n')
    expect(tracked).toEqual(['themes/fonts/README.md'])
    const ignored = execFileSync('git', ['check-ignore', '--', ...tree(fontsDir).map((rel) => `themes/fonts/${rel}`)],
      { encoding: 'utf8' }).trim().split('\n')
    expect(ignored).toEqual(tree(fontsDir).filter((rel) => rel !== 'README.md').map((rel) => `themes/fonts/${rel}`))
  })
})

describe('resource packs', () => {
  const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { devDependencies: Record<string, string> }
  const manifest = (): PackManifest => JSON.parse(generated.manifest) as PackManifest

  it('writes a sheet per pack and the manifest from the lockfile, offline', () => {
    expect(readdirSync(path.join(outDir, PACKS_DIR)).sort()).toEqual([PACK_MANIFEST,
      ...PACK_FAMILIES.map(({ pkg: name }) => `${path.basename(name)}.css`)].sort())
    expect(readFileSync(path.join(outDir, PACKS_DIR, PACK_MANIFEST), 'utf8')).toBe(generated.manifest)
  })

  it('pins each pack to the bundled CJK version line, from the registry, with its sha512', () => {
    const lock = JSON.parse(readFileSync(path.resolve('package-lock.json'), 'utf8')) as
      { packages: Record<string, { resolved?: string; integrity?: string }> }
    const bundledCjk = new Set(VENDORED_FAMILIES.filter(({ family }) => family.startsWith('Noto'))
      .map(({ pkg: name }) => pkg.devDependencies[name]))
    expect(bundledCjk.size).toBe(1)
    expect(Object.keys(manifest().packs)).toEqual(PACK_FAMILIES.map(({ pkg: name }) => path.basename(name)))
    for (const [name, pack] of Object.entries(manifest().packs)) {
      expect(pkg.devDependencies[pack.package], name).toBe(pack.version)
      expect(bundledCjk.has(pack.version), name).toBe(true)
      expect(pack.url).toBe(`https://registry.npmjs.org/${pack.package}/-/${name}-${pack.version}.tgz`)
      expect(pack.url).toBe(lock.packages[`node_modules/${pack.package}`]?.resolved)
      expect(pack.integrity).toBe(lock.packages[`node_modules/${pack.package}`]?.integrity)
      expect(pack.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/)
    }
  })

  it('declares exactly the pack files, by bare name, and writes no pack font', () => {
    for (const [name, pack] of Object.entries(manifest().packs)) {
      const sheet = generated.packSheets.get(`${PACKS_DIR}/${pack.sheet}`)!
      postcss.parse(sheet).walkAtRules('font-face', (rule) => {
        let ranges = 0
        rule.walkDecls('unicode-range', () => { ranges++ })
        expect(ranges, name).toBe(1)
      })
      const { families, urls } = faceUrls(sheet)
      expect(families).toEqual([pack.family])
      expect(urls).toEqual(pack.files)
      for (const file of pack.files) expect(file).toMatch(new RegExp(`^${name}-[a-z0-9-]+-wght-normal\\.woff2$`))
    }
    expect(readdirSync(path.join(outDir, PACKS_DIR)).filter((file) => !/\.(css|json)$/.test(file))).toEqual([])
  })
})
