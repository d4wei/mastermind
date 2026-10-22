import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { scanThemes } from '../themes/discovery'
import { COLOR_TOKS, CODE_THEMES } from '../ui/theme/codeThemes'
import { declarations, themeIds, themesRoot, themeTokens, themeAppearance, printTokens,
  rgb, composite, contrast } from './helpers/themes'

const uiRoot = path.resolve('ui')
const uiSources = readdirSync(uiRoot, { recursive: true }).map(String)
  .filter((name) => /\.(css|tsx?)$/.test(name))
  .map((name) => ({ name, source: readFileSync(path.join(uiRoot, name), 'utf8') }))
const uiCss = uiSources.filter(({ name }) => name.endsWith('.css')).map(({ source }) => source).join('\n')
const uiDefaults = declarations(uiCss)
const references = (source: string) => [...source.matchAll(/var\((--[a-z0-9-]+)|['"](--[a-z0-9-]+)['"]/g)].map((match) => (match[1] ?? match[2])!)
const runtimeTokens = new Set([
  '--radix-popover-content-available-width', '--radix-popover-content-available-height',
  ...COLOR_TOKS.map((token) => `--code-${token}`), '--heading-count', '--heading-depth',
])

describe('theme token contract', () => {
  it('discovers palette previews from the same colors the interface uses', async () => {
    const themes = await scanThemes(themesRoot)
    expect(themes.map(({ id }) => id)).toEqual(themeIds.sort())
    expect(themes.map(({ id }) => id)).toContain('grid')
    for (const theme of themes) {
      const tokens = themeTokens(theme.id)
      const css = readFileSync(path.join(themesRoot, theme.id, 'tokens.css'), 'utf8')
      expect(css).toContain(`color-scheme: ${theme.appearance}`)
      expect(theme.swatch).toEqual({ bg: tokens['--color-bg'], ink: tokens['--color-text-muted'],
        accent: tokens['--color-accent'] })
    }
  })

  it.each([['a number', { name: 42 }], ['an empty string', { name: '' }], ['absent', {}]])(
    'names a theme by its id when the declared name is %s', async (_label, json) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-themes-'))
      try {
        await fs.mkdir(path.join(root, 'custom'))
        await fs.writeFile(path.join(root, 'custom', 'theme.json'), JSON.stringify(json))
        await fs.copyFile(path.join(themesRoot, 'grid', 'tokens.css'), path.join(root, 'custom', 'tokens.css'))
        expect((await scanThemes(root)).map(({ id, name }) => ({ id, name }))).toEqual([{ id: 'custom', name: 'custom' }])
      } finally { await fs.rm(root, { recursive: true, force: true }) }
    })

  it.each(themeIds)('%s defines every consumed token without orphan palette tokens', (id) => {
    const tokens = themeTokens(id)
    const defined = new Set([...Object.keys(uiDefaults), ...Object.keys(tokens), ...runtimeTokens])
    const used = new Set(references([...uiSources.map(({ source }) => source), ...Object.values(tokens)].join('\n')))
    for (const name of used) expect(defined.has(name), `${id}: undefined ${name}`).toBe(true)
    for (const name of Object.keys(tokens)) expect(used.has(name), `${id}: unused ${name}`).toBe(true)
    expect(Object.keys(tokens).sort()).toEqual(Object.keys(themeTokens('grid')).sort())
  })

  it.each(themeIds)('%s keeps primary labels readable in every enabled state', (id) => {
    const tokens = themeTokens(id)
    for (const background of ['--color-accent', '--color-accent-hover', '--color-accent-pressed']) {
      expect(contrast(rgb('--color-on-accent', tokens), rgb(background, tokens)), `${id}: ${background}`)
        .toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(themeIds)('%s keeps neutral focus distinct from adjacent control surfaces', (id) => {
    const tokens = themeTokens(id)
    const paper = rgb('--color-bg', tokens)
    for (const surface of ['--color-bg', '--color-bg-elevated', '--color-control-hover',
      '--color-control-pressed', '--color-selection']) {
      expect(contrast(rgb('--focus-ring', tokens), composite(rgb(surface, tokens), paper)), `${id}: ${surface}`)
        .toBeGreaterThanOrEqual(3)
    }
  })

  it.each(themeIds)('%s keeps review text and markers legible', (id) => {
    for (const tokens of [themeTokens(id), { ...themeTokens(id), ...printTokens }]) {
      const paper = rgb('--color-bg', tokens)
      for (const kind of ['insert', 'delete']) {
        const fill = composite(rgb(`--review-${kind}-bg`, tokens), paper)
        expect(contrast(rgb(`--review-${kind}-text`, tokens), fill), `${id}: ${kind}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const surface of ['--color-bg', '--color-bg-elevated', '--review-comment-active-bg']) {
        expect(contrast(rgb('--review-comment-anchor', tokens), composite(rgb(surface, tokens), paper)),
          `${id}: comment on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(tokens['--review-comment-anchor']).not.toBe(tokens['--review-insert-text'])
    }
  })

  it.each(themeIds)('%s keeps optional code palettes readable on code blocks', (id) => {
    const tokens = themeTokens(id)
    const background = rgb('--color-bg-elevated', tokens)
    for (const scheme of CODE_THEMES) {
      for (const [kind, color] of Object.entries(scheme.palettes?.[themeAppearance(id)] ?? {})) {
        expect(contrast(rgb(color, tokens), background), `${id}: ${scheme.id}/${kind}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
