// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cssMs, cssPx } from '../ui/util/css-tokens'

afterEach(() => { document.documentElement.removeAttribute('style') })

function style(declarations: string): CSSStyleDeclaration {
  document.documentElement.setAttribute('style', declarations)
  return getComputedStyle(document.documentElement)
}

it('reads time tokens in milliseconds from either unit', () => {
  const css = style('--fast: 120ms; --slow: 0.26s; --spaced:  180ms ')
  expect(cssMs(css, '--fast')).toBe(120)
  expect(cssMs(css, '--slow')).toBe(260)
  expect(cssMs(css, '--spaced')).toBe(180)
})

it('reports an unset or non-time token as unavailable', () => {
  const css = style('--width: 12px; --word: fast')
  expect(cssMs(css, '--missing')).toBeNull()
  expect(cssMs(css, '--width')).toBeNull()
  expect(cssMs(css, '--word')).toBeNull()
})

it('reads length tokens in pixels and treats an unset token as zero', () => {
  const css = style('--edge: 16px; --fraction: 6.5px')
  expect(cssPx(css, '--edge')).toBe(16)
  expect(cssPx(css, '--fraction')).toBe(6.5)
  expect(cssPx(css, '--missing')).toBe(0)
})
