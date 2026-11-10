import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { FACES_SHEET, PACK_FAMILIES, PACK_MANIFEST, PACKS_DIR, VENDORED_FAMILIES, vendoredFonts, type PackManifest }
  from '../tools/fonts/vendor-fonts.mjs'

const fontsDir = path.resolve('themes/fonts')
const sheet = readFileSync(path.join(fontsDir, FACES_SHEET), 'utf8')
const declaredUrls: string[] = []
postcss.parse(sheet).walkAtRules('font-face', (rule) => {
  rule.walkDecls('src', (decl) => {
    for (const [, url] of decl.value.matchAll(/url\('([^']+)'\)/g)) declaredUrls.push(url!)
  })
})

describe('vendored fonts', () => {
  it('declares only faces whose files exist beside the sheet', () => {
    expect(declaredUrls.length).toBeGreaterThan(0)
    for (const url of declaredUrls) expect(existsSync(path.join(fontsDir, url)), url).toBe(true)
  })

  it('declares every bundled woff2 under the themes tree', () => {
    const declared = new Set(declaredUrls.map((url) => path.join('fonts', url)))
    const bundled = readdirSync(path.resolve('themes'), { recursive: true, encoding: 'utf8' })
      .filter((rel) => rel.endsWith('.woff2'))
    expect(bundled.filter((rel) => !declared.has(rel))).toEqual([])
  })

  it('matches the pinned packages byte for byte, licences included', async () => {
    const { files, css } = await vendoredFonts(path.resolve('node_modules'))
    expect(sheet).toBe(css)
    const { packSheets } = await vendoredFonts(path.resolve('node_modules'))
    const generated = new Set([FACES_SHEET, 'README.md', ...files.keys(), ...packSheets.keys(),
      `${PACKS_DIR}/${PACK_MANIFEST}`])
    const committed = readdirSync(fontsDir, { recursive: true, encoding: 'utf8' })
      .filter((rel) => statSync(path.join(fontsDir, rel)).isFile())
      .map((rel) => rel.split(path.sep).join('/'))
    expect(committed.filter((rel) => !generated.has(rel))).toEqual([])
    for (const [target, source] of files) {
      expect(readFileSync(path.join(fontsDir, target)).equals(readFileSync(source)), target).toBe(true)
    }
    for (const dir of new Set([...files.keys()].map((target) => target.split('/')[0]))) {
      expect(files.has(`${dir}/OFL.txt`), dir).toBe(true)
    }
  })
})

describe('resource packs', () => {
  const packsDir = path.join(fontsDir, PACKS_DIR)
  const manifest = JSON.parse(readFileSync(path.join(packsDir, PACK_MANIFEST), 'utf8')) as PackManifest
  const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { devDependencies: Record<string, string> }

  it('commits the sheets and manifest the script writes from the lockfile, offline', async () => {
    const generated = await vendoredFonts(path.resolve('node_modules'), path.resolve('package-lock.json'))
    expect(readFileSync(path.join(packsDir, PACK_MANIFEST), 'utf8')).toBe(generated.manifest)
    for (const [target, text] of generated.packSheets) expect(readFileSync(path.join(fontsDir, target), 'utf8'), target).toBe(text)
    expect(readdirSync(packsDir).sort()).toEqual([PACK_MANIFEST, ...[...generated.packSheets.keys()]
      .map((target) => path.basename(target))].sort())
  })

  it('pins each pack to the bundled CJK version line, from the registry, with its sha512', () => {
    const bundledCjk = new Set(VENDORED_FAMILIES.filter(({ family }) => family.startsWith('Noto'))
      .map(({ pkg: name }) => pkg.devDependencies[name]))
    expect(bundledCjk.size).toBe(1)
    expect(Object.keys(manifest.packs)).toEqual(PACK_FAMILIES.map(({ pkg: name }) => path.basename(name)))
    for (const [name, pack] of Object.entries(manifest.packs)) {
      expect(pkg.devDependencies[pack.package], name).toBe(pack.version)
      expect(bundledCjk.has(pack.version), name).toBe(true)
      expect(pack.url).toBe(`https://registry.npmjs.org/${pack.package}/-/${name}-${pack.version}.tgz`)
      expect(pack.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/)
    }
  })

  it('declares exactly the pack files, by bare name, and commits no font file', () => {
    for (const [name, pack] of Object.entries(manifest.packs)) {
      const urls: string[] = []
      const families = new Set<string>()
      postcss.parse(readFileSync(path.join(packsDir, pack.sheet), 'utf8')).walkAtRules('font-face', (rule) => {
        rule.walkDecls('src', (decl) => { for (const [, url] of decl.value.matchAll(/url\('([^']+)'\)/g)) urls.push(url!) })
        rule.walkDecls('font-family', (decl) => { families.add(decl.value) })
        let ranges = 0
        rule.walkDecls('unicode-range', () => { ranges++ })
        expect(ranges, name).toBe(1)
      })
      expect([...families]).toEqual([`'${pack.family}'`])
      expect(urls).toEqual(pack.files)
      for (const file of pack.files) expect(file).toMatch(new RegExp(`^${name}-[a-z0-9-]+-wght-normal\\.woff2$`))
    }
    expect(readdirSync(packsDir).filter((file) => !/\.(css|json)$/.test(file))).toEqual([])
  })
})
