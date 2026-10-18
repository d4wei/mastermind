// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it } from 'vitest'
import { themeTokens } from './helpers/themes'
import { Frontmatter } from '../ui/modes/reading/Frontmatter'

const radii = themeTokens('grid')

function installStyles() {
  const style = document.createElement('style')
  // jsdom does not resolve custom properties; retain the actual selectors and cascade.
  style.textContent = ['ui/app/app.css', 'ui/desktop/native.css', 'ui/app/Notifications.css',
    'ui/modes/reading/frontmatter.css', 'ui/find/find.css'].map((file) => readFileSync(file, 'utf8')).join('\n')
    .replace(/var\((--radius-[a-z]+)\)/g, (_, name: string) => radii[name]!)
    .replaceAll('var(--space-unit)', '4px')
  document.head.append(style)
}

afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren() })

it('gives peer controls and floating surfaces consistent corners', () => {
  installStyles()
  const groups = [
    ['btn-primary', 'btn-ghost', 'settings-input', 'theme-chip', 'native-open', 'native-file-pill'],
    ['reader-menu', 'rail-card', 'sel-toolbar', 'slide-over', 'lang-menu', 'outline-popover',
      'find-bar', 'notification'],
    ['reader-menu-item', 'lang-option', 'native-file-close'],
  ]
  for (const [index, names] of groups.entries()) {
    const expected = [radii['--radius-md'], radii['--radius-lg'], radii['--radius-xs']][index]
    for (const name of names) {
      const element = document.createElement('div')
      element.className = name
      document.body.append(element)
      expect(getComputedStyle(element).borderRadius, name).toBe(expected)
    }
  }
})

it('adds no frontmatter top inset and leaves space between properties and below the divider', () => {
  installStyles()
  document.body.innerHTML = renderToStaticMarkup(<Frontmatter source={'status: living\nupdated: today'} />)
  const properties = getComputedStyle(document.querySelector('.md-properties')!)
  expect(properties.marginTop).toBe('0px')
  expect(properties.paddingTop).toBe('0px')
  expect(properties.columnGap).toBe('calc(24px)')
  expect(properties.marginBottom).toBe('calc(16px)')
  expect(properties.paddingBottom).toBe('calc(8px)')
  expect(getComputedStyle(document.querySelector('dd')!).marginLeft).toBe('0px')
  document.body.innerHTML = renderToStaticMarkup(<Frontmatter source={'items:\n  - one'} />)
  expect(getComputedStyle(document.querySelector('pre')!).marginTop).toBe('0px')
})
