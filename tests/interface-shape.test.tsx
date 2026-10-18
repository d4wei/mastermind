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
    .replaceAll('var(--control-size-compact)', '24px')
    .replaceAll('var(--control-size)', '30px')
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

it('keeps icon-only hover targets square without inherited text-button padding', () => {
  installStyles()
  const controls = [
    ['btn-ghost btn-icon topbar-icon-btn', 30], ['native-open btn-icon', 30],
    ['btn-ghost btn-icon find-nav', 24], ['btn-ghost btn-icon slide-over-close', 24],
    ['btn-ghost btn-icon notification-dismiss', 24], ['btn-ghost btn-icon recovery-warning', 24],
    ['native-file-close btn-icon', 24], ['native-file-attention btn-ghost btn-icon', 24],
    ['btn-ghost btn-icon rail-icon', 24],
  ] as const
  for (const [classes, size] of controls) {
    const parent = document.createElement('div'); parent.className = 'rail-message-header'
    const button = document.createElement('button'); button.className = classes
    parent.append(button); document.body.append(parent)
    const style = getComputedStyle(button)
    expect(style.width, classes).toBe(`${size}px`)
    expect(style.height, classes).toBe(`${size}px`)
    for (const edge of ['Top', 'Right', 'Bottom', 'Left'] as const) expect(style[`padding${edge}`], classes).toBe('0px')
    expect(style.flexShrink, classes).toBe('0')
  }
  document.body.innerHTML = '<div class="seg preset-seg"><button class="seg-btn btn-icon"></button></div>'
  const preset = getComputedStyle(document.querySelector('button')!)
  expect(preset.width).toBe('30px')
  expect(preset.height).toBe('30px')
  expect(preset.padding).toBe('0px')
  expect(preset.flexShrink).toBe('0')
})

it('reserves counter space and groups compact Find controls without gaps', () => {
  installStyles()
  document.body.innerHTML = '<span class="find-count"><span class="find-count-size" aria-hidden="true">12 of 12</span><span>1 of 12</span></span><div class="find-actions"></div>'
  const count = document.querySelector('.find-count')!
  expect(getComputedStyle(count).fontVariantNumeric).toBe('tabular-nums')
  expect(getComputedStyle(count).display).toBe('grid')
  for (const child of count.children) expect(getComputedStyle(child).gridArea).toBe('1 / 1')
  expect(getComputedStyle(count.firstElementChild!).visibility).toBe('hidden')
  expect(getComputedStyle(document.querySelector('.find-actions')!).gap).toBe('0px')
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
