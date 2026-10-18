// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'

function styles() {
  const sheet = document.createElement('style')
  const colors: Record<string, string> = {
    '--color-control-hover': 'rgb(210, 210, 210)', '--color-control-pressed': 'rgb(190, 190, 190)',
    '--color-text': 'rgb(20, 20, 20)', '--color-text-muted': 'rgb(100, 100, 100)',
    '--color-selection': 'rgb(170, 170, 170)', '--color-bg': 'rgb(250, 250, 250)',
    '--color-bg-elevated': 'rgb(240, 240, 240)', '--color-invert-bg-elevated': 'rgb(45, 45, 45)',
    '--color-invert-text': 'rgb(245, 245, 245)',
  }
  // Substitute only the browser's hover state and custom-property resolution for jsdom.
  sheet.textContent = ['ui/app/app.css', 'ui/desktop/native.css'].map((path) => readFileSync(path, 'utf8')).join('\n')
    .replaceAll(':hover', '.test-hover').replace(/var\((--[a-z-]+)\)/g, (match, token: string) => colors[token] ?? match)
  document.head.append(sheet)
}
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren() })

it('uses one visible hover fill on ordinary controls while keeping disabled and selected states distinct', () => {
  styles()
  for (const name of ['btn-ghost', 'seg-btn', 'theme-chip', 'lang-trigger', 'find-nav',
    'native-open', 'native-file-close', 'native-file-pill']) {
    const button = document.createElement('button')
    button.className = `${name} test-hover`
    document.body.append(button)
    expect(getComputedStyle(button).backgroundColor, name).toBe('rgb(210, 210, 210)')
    expect(getComputedStyle(button).color, name).toBe('rgb(20, 20, 20)')
    button.disabled = true
    expect(getComputedStyle(button).backgroundColor, name).not.toBe('rgb(210, 210, 210)')
  }
  const selected = document.createElement('div')
  selected.className = 'native-file-pill active test-hover'
  document.body.append(selected)
  expect(getComputedStyle(selected).backgroundColor).toBe('rgb(170, 170, 170)')
})

it('keeps inverted toolbar and composer actions readable on hover, excluding disabled actions', () => {
  styles()
  document.body.innerHTML = '<div class="sel-toolbar"><button class="test-hover">Comment</button><div class="sel-composer-actions"><button class="test-hover">Cancel</button></div></div>'
  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
    expect(getComputedStyle(button).backgroundColor).toBe('rgb(45, 45, 45)')
    expect(getComputedStyle(button).color).toBe('rgb(245, 245, 245)')
    button.disabled = true
    expect(getComputedStyle(button).backgroundColor).not.toBe('rgb(45, 45, 45)')
  }
})
