import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const themesRoot = fileURLToPath(new URL('../themes', import.meta.url))
const themes = readdirSync(themesRoot).filter((id) => existsSync(path.join(themesRoot, id, 'theme.json')))
const tokens = new Map(themes.map((id) => {
  const css = readFileSync(path.join(themesRoot, id, 'tokens.css'), 'utf8')
  return [id, new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]!))]
}))

// These semantic families are consumed by the interface regardless of palette choice.
const required = [
  '--color-bg', '--color-bg-elevated', '--color-text', '--color-text-muted', '--color-text-faint',
  '--color-border', '--color-accent', '--color-accent-dim', '--color-accent-surface',
  '--color-on-accent', '--color-cta-bg', '--color-cta-text', '--color-border-hover', '--color-selection', '--focus-ring', '--color-invert-bg',
  '--color-invert-text', '--color-invert-text-muted', '--color-invert-border',
  '--review-comment-anchor', '--review-comment-active-bg',
  '--review-highlight-bg', '--review-highlight-border',
  ...['insert', 'delete'].flatMap((kind) => ['text', 'bg', 'border'].map((part) => `--review-${kind}-${part}`)),
]

describe('theme token contract', () => {
  it('discovers the reference theme from the maintained manifests', () => {
    expect(themes).toContain('grid')
  })
  it.each(themes)('%s supplies the semantic tokens and the common palette schema', (id) => {
    const names = tokens.get(id)!
    for (const name of required) expect(names.has(name), `${id}: ${name}`).toBe(true)
    expect([...names].sort()).toEqual([...tokens.get('grid')!].sort())
  })
})
