// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useConfig } from '../ui/app/configStore'
import { installHost } from '../ui/app/host'
import { DEFAULT_CONFIG } from '../ui/settings/defaults'
import { ThemeEffects } from '../ui/theme/ThemeProvider'
import { fakeHost } from './helpers/host'
import { declarations } from './helpers/themes'

const ROOT_PX = 16
const sheets = ['ui/app/app.css', 'ui/modes/reading/frontmatter.css'].map((file) => postcss.parse(readFileSync(file, 'utf8')))
const rootTokens = declarations(readFileSync('themes/common.css', 'utf8'))

function inPrint(node: postcss.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && (parent as postcss.AtRule).params === 'print') return true
  }
  return false
}

/** Font-size declarations by rule selector; print rules only when asked. */
function fontSizes(print = false): Array<{ selectors: string[]; value: string }> {
  const found: Array<{ selectors: string[]; value: string }> = []
  for (const sheet of sheets) sheet.walkDecls('font-size', (decl) => {
    const rule = decl.parent
    if (rule?.type === 'rule' && (print || !inPrint(decl))) found.push({ selectors: (rule as postcss.Rule).selectors, value: decl.value })
  })
  return found
}

/** Resolves a font-size value to pixels; jsdom computes neither var() nor calc(). */
function pixels(value: string, tokens: Record<string, string>, parentPx: number): number {
  let expression = value
  for (let depth = 0; expression.includes('var('); depth++) {
    if (depth > 8) throw new Error(`unresolved ${value}`)
    expression = expression.replace(/var\((--[\w-]+)\)/g, (_, name: string) => `(${tokens[name] ?? 'NaN'})`)
  }
  expression = expression.replace(/calc/g, '').replace(/(\d*\.?\d+)(rem|em|px)/g, (_, number: string, unit: string) =>
    String(Number(number) * (unit === 'rem' ? ROOT_PX : unit === 'em' ? parentPx : 1)))
  if (!/^[\d.\s+\-*/()]+$/.test(expression)) throw new Error(`cannot evaluate ${value}`)
  return Number(Function(`return (${expression})`)())
}

function sizeOf(selector: string, tokens: Record<string, string>, parentPx: number): number {
  const rule = fontSizes().find((entry) => entry.selectors.includes(selector))
  if (!rule) throw new Error(`no font-size for ${selector}`)
  return pixels(rule.value, tokens, parentPx)
}

afterEach(() => {
  document.documentElement.removeAttribute('style')
  document.head.replaceChildren()
  installHost(null)
  vi.unstubAllGlobals()
})

it('scales frontmatter properties with the body font size while chrome keeps its rem size', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  installHost(fakeHost())
  useConfig.setState({ config: { ...DEFAULT_CONFIG, fontSize: 20 }, themes: [] })
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeEffects />))
  const tokens = { ...rootTokens, '--font-size-body': document.documentElement.style.getPropertyValue('--font-size-body') }
  act(() => root.unmount())
  const body = sizeOf('body', tokens, ROOT_PX)
  expect(body).toBe(20)
  expect(sizeOf('.md-properties', tokens, body)).toBe(0.875 * 20)
  expect(sizeOf('.sel-toolbar > button', tokens, body)).toBe(pixels('var(--font-size-sm)', tokens, body))
  expect(sizeOf('.sel-toolbar > button', tokens, body)).toBe(0.875 * ROOT_PX)
})

it('sizes document-body text relative to the body, never with a fixed rem size', () => {
  const body = /\.md-|\.critic-|\.print-footnotes/
  // Expands every token except the body size itself, which the font size setting controls.
  const expand = (value: string): string => value.replace(/var\((--[\w-]+)\)/g, (reference, name: string) =>
    name === '--font-size-body' ? '' : expand(rootTokens[name] ?? reference))
  const fixed = fontSizes(true).filter(({ selectors, value }) =>
    selectors.some((selector) => body.test(selector)) && /rem\b|px\b/.test(expand(value)))
  expect(fixed).toEqual([])
})
