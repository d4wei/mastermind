import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { FACES_SHEET, vendoredFonts } from '../tools/fonts/vendor-fonts.mjs'

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
    const generated = new Set([FACES_SHEET, 'README.md', ...files.keys()])
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
