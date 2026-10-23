import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { isThemeAsset, resolveThemeAsset, scanThemes } from '../themes/discovery'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-themes-'))
  await fs.mkdir(path.join(dir, 'themes', 'grid'), { recursive: true })
  await fs.writeFile(path.join(dir, 'themes', 'grid', 'tokens.css'), ':root {}')
  await fs.writeFile(path.join(dir, 'themes', 'README.md'), 'doc')
  await fs.writeFile(path.join(dir, 'secret.css'), 'outside')
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

it('ships theme assets without TypeScript sources or Markdown docs', () => {
  expect(isThemeAsset('grid/tokens.css')).toBe(true)
  expect(isThemeAsset('fonts/Inter-Variable.woff2')).toBe(true)
  for (const name of ['discovery.ts', 'README.md', 'notes.MD']) expect(isThemeAsset(name)).toBe(false)
})

it('resolves only regular, included files inside the themes directory', async () => {
  const themes = path.join(dir, 'themes')
  expect(await resolveThemeAsset(themes, 'grid/tokens.css')).toBe(await fs.realpath(path.join(themes, 'grid', 'tokens.css')))
  for (const name of ['README.md', 'grid', 'missing.css', '../secret.css', 'grid/../../secret.css', path.join(dir, 'secret.css'), 'a\0b.css']) {
    expect(await resolveThemeAsset(themes, name)).toBeNull()
  }
})

it.runIf(process.platform !== 'win32')('refuses links that leave the themes directory or rename an excluded file', async () => {
  const themes = path.join(dir, 'themes')
  await fs.symlink(path.join(dir, 'secret.css'), path.join(themes, 'escape.css'))
  await fs.symlink(path.join(themes, 'README.md'), path.join(themes, 'readme.css'))
  expect(await resolveThemeAsset(themes, 'escape.css')).toBeNull()
  expect(await resolveThemeAsset(themes, 'readme.css')).toBeNull()
})

let server: ViteDevServer
let origin: string
beforeAll(async () => {
  server = await createServer({ configFile: path.resolve('vite.config.ts'), logLevel: 'silent',
    server: { port: 0, strictPort: false, hmr: false } })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('dev server has no port')
  origin = `http://localhost:${address.port}`
})
afterAll(async () => { await server.close() })

it('serves the theme catalog and assets beside the desktop entry in development', async () => {
  const catalog = await fetch(`${origin}/themes.json`)
  expect(catalog.headers.get('content-type')).toMatch(/^application\/json/)
  expect(await catalog.json()).toEqual(await scanThemes(path.resolve('themes')))
  const tokens = await fetch(`${origin}/themes/grid/tokens.css`)
  expect(tokens.headers.get('content-type')).toMatch(/^text\/css/)
  expect(await tokens.text()).toBe(await fs.readFile(path.resolve('themes/grid/tokens.css'), 'utf8'))
  for (const name of ['README.md', 'discovery.ts', '..%2fpackage.json', '%2e%2e/package.json', '%E0%A4%A']) {
    expect((await fetch(`${origin}/themes/${name}`)).status).toBe(404)
  }
})

it('answers reviewer routes with the desktop entry so a reload keeps the reviewer', async () => {
  for (const route of ['/', '/d/3']) {
    const page = await fetch(`${origin}${route}`, { headers: { accept: 'text/html' } })
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('/desktop/main.tsx')
  }
})
