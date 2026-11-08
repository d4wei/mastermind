// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { themeTokens } from './helpers/themes'
import { Frontmatter, loadMetadataParser } from '../ui/modes/reading/Frontmatter'

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
    ['reader-menu', 'rail-card', 'sel-toolbar', 'slide-over', 'outline-popover',
      'find-bar', 'notification'],
    ['reader-menu-item', 'native-file-close'],
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
    ['btn-ghost btn-icon find-nav', 24], ['btn-ghost btn-icon slide-over-close', 28],
    ['btn-ghost btn-icon notification-dismiss', 24], ['btn-ghost btn-icon recovery-warning', 24],
    ['native-file-close btn-icon', 24], ['native-file-attention btn-ghost btn-icon', 24],
    ['btn-ghost btn-icon rail-icon', 24],
  ] as const
  for (const [classes, size] of controls) {
    const parent = document.createElement('div'); parent.className = 'rail-message-header'
    const button = document.createElement('button'); button.className = classes
    parent.append(button); document.body.append(parent)
    const style = getComputedStyle(button)
    // jsdom keeps a calc() wrapper around token arithmetic.
    expect(style.width.replace(/^calc\((.*)\)$/, '$1'), classes).toBe(`${size}px`)
    expect(style.height.replace(/^calc\((.*)\)$/, '$1'), classes).toBe(`${size}px`)
    for (const edge of ['Top', 'Right', 'Bottom', 'Left'] as const) expect(style[`padding${edge}`], classes).toBe('0px')
    expect(style.flexShrink, classes).toBe('0')
  }
})

it('keeps segmented choices wide', () => {
  installStyles()
  document.body.innerHTML = '<div class="seg preset-seg"><button class="seg-btn"></button></div>'
  const preset = getComputedStyle(document.querySelector('button')!)
  expect(getComputedStyle(document.querySelector('.preset-seg')!).width).toBe('100%')
  expect(preset.flexGrow).toBe('1')
  expect(preset.minHeight).toBe('calc(34px)')
  expect(preset.padding).toBe('0px')
})

it('insets the panel close control to the content edge with a compact glyph and a full hit target', () => {
  installStyles()
  document.body.innerHTML = '<div class="slide-over"><div class="slide-over-head"><span class="slide-over-title">Settings</span>' +
    '<button class="btn-ghost btn-icon slide-over-close"><svg></svg></button></div><div class="slide-over-body"></div></div>'
  const head = getComputedStyle(document.querySelector('.slide-over-head')!)
  const close = getComputedStyle(document.querySelector('.slide-over-close')!)
  const glyph = getComputedStyle(document.querySelector('.slide-over-close svg')!)
  const body = getComputedStyle(document.querySelector('.slide-over-body')!)
  // The glyph's right edge sits where the body's content begins: head padding + margin + half the spare width.
  const px = (value: string) => Number(value.replace(/^calc\((.*)\)$/, '$1').replace(/px$/, '').replace(/^(-?\d+)px \* (-?\d+)$/, (_, a, b) => String(a * b)))
  const glyphInset = px(head.paddingRight) + px(close.marginRight) + (px(close.width) - px(glyph.width)) / 2
  expect(glyphInset).toBe(px(body.paddingRight))
  expect(px(head.paddingRight) + px(close.marginRight)).toBe(8)
  expect(px(close.width)).toBeGreaterThanOrEqual(28)
  expect(px(glyph.width)).toBeLessThan(14)
})

it('gives Find the shared panel width and keeps the counter inside a field that never sets its own width', () => {
  installStyles()
  document.body.innerHTML = '<div class="find-bar"><div class="find-field"><svg></svg><input class="settings-input find-input"><span class="find-count">1/12</span></div><div class="find-actions"></div></div>' +
    '<div class="slide-over"></div>'
  const bar = getComputedStyle(document.querySelector('.find-bar')!)
  const field = getComputedStyle(document.querySelector('.find-field')!)
  const input = getComputedStyle(document.querySelector('.find-input')!)
  const count = getComputedStyle(document.querySelector('.find-count')!)
  expect(bar.width).toBe(getComputedStyle(document.querySelector('.slide-over')!).width)
  expect(bar.width).toContain('var(--panel-width)')
  expect(field.position).toBe('relative')
  expect(field.flexGrow).toBe('1')
  expect(field.width).toBe('auto')
  expect(field.minWidth).toContain('var(--panel-width)')
  expect(count.position).toBe('absolute')
  expect(count.fontVariantNumeric).toBe('tabular-nums')
  // The input's right padding covers the counter's offset and widest box, so typing never reaches it.
  expect(input.paddingRight).toBe('calc(60px)')
  expect(count.right).toBe('calc(8px)')
  expect(count.maxWidth).toBe('calc(48px)')
  expect(getComputedStyle(document.querySelector('.find-actions')!).gap).toBe('0px')
})

it('gives composer actions one face, size, and height and keeps every chrome control sentence case', () => {
  installStyles()
  document.body.innerHTML = '<div class="rail-reply"><textarea></textarea><div class="rail-actions"><button class="btn-ghost btn-compact">Cancel</button><button class="btn-primary btn-compact">Reply</button></div></div>' +
    '<div class="sel-toolbar"><div class="sel-composer"><div class="sel-composer-actions"><button class="btn-compact">Cancel</button><button class="btn-primary btn-compact">Suggest change</button></div></div></div>'
  for (const group of document.querySelectorAll('.rail-actions, .sel-composer-actions')) {
    const [secondary, primary] = Array.from(group.querySelectorAll('button'), (button) => getComputedStyle(button))
    for (const property of ['fontFamily', 'fontSize', 'height', 'lineHeight', 'paddingLeft'] as const) {
      expect(secondary![property], `${group.className} ${property}`).toBe(primary![property])
    }
    expect(secondary!.textTransform).not.toBe('uppercase')
  }
  const reply = getComputedStyle(document.querySelector('.rail-reply textarea')!)
  expect(reply.resize).toBe('vertical')
  // Two full lines of reply text plus the field's vertical padding and border.
  expect(reply.minHeight).toBe('calc(var(--font-size-sm) * var(--lh-snug) * 2 + 4px * 4 + 2px)')
})

beforeAll(loadMetadataParser)

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
