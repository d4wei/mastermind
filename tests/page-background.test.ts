// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'

const css = readFileSync('ui/app/app.css', 'utf8')

afterEach(() => document.head.replaceChildren())

it.each([['#f2ecdf', 'rgb(242, 236, 223)'], ['#171717', 'rgb(23, 23, 23)']])(
  'paints the page root and body with the theme background %s', (color, expected) => {
    const style = document.createElement('style')
    // jsdom does not resolve custom properties; substitute only the background token to check its cascade.
    style.textContent = css.replaceAll('var(--color-bg)', color)
    document.head.append(style)
    const rootBackground = getComputedStyle(document.documentElement).backgroundColor
    expect(rootBackground).toBe(expected)
    expect(rootBackground).toBe(getComputedStyle(document.body).backgroundColor)
  },
)
