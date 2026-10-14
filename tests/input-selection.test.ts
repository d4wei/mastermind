// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

let style: HTMLStyleElement
let host: HTMLDivElement
beforeEach(() => {
  style = document.createElement('style')
  style.textContent = readFileSync(path.join(__dirname, '../ui/app/app.css'), 'utf8')
  document.head.append(style)
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => { host.remove(); style.remove() })

it('keeps settings chrome nonselectable while preserving editable and document text', () => {
  host.innerHTML = `
    <div class="slide-over" id="settings">
      <div class="slide-over-title">Settings</div>
      <div class="settings-body">
        <span>Name</span><input type="text" value="alex">
        <input type="search" value="English"><textarea>Editable text</textarea>
      </div>
    </div>
    <div class="slide-over" id="other">Another panel</div>
    <article class="md-root">Document text</article>`
  expect(getComputedStyle(host.querySelector('#settings')!).userSelect).toBe('none')
  for (const field of host.querySelectorAll('input,textarea')) {
    expect(getComputedStyle(field).userSelect).toBe('text')
  }
  const author = host.querySelector<HTMLInputElement>('input[type="text"]')!
  author.focus()
  author.setSelectionRange(0, author.value.length)
  expect(author.value.slice(author.selectionStart!, author.selectionEnd!)).toBe('alex')
  expect(getComputedStyle(host.querySelector('#other')!).userSelect).not.toBe('none')
  expect(getComputedStyle(host.querySelector('article')!).userSelect).not.toBe('none')
})

it('uses inverted tokens for composer selection and retains input ranges after blur', () => {
  host.className = 'sel-composer'
  host.innerHTML = '<textarea>Selected comment text</textarea><button>Blur</button>'
  const selectionRule = Array.from(style.sheet!.cssRules).find((rule) =>
    'selectorText' in rule && rule.selectorText === '.sel-composer textarea::selection') as CSSStyleRule
  expect(selectionRule.style.getPropertyValue('background')).toBe('var(--color-invert-text)')
  expect(selectionRule.style.getPropertyValue('color')).toBe('var(--color-invert-bg)')
  const input = host.querySelector('textarea')!
  expect(getComputedStyle(input).userSelect).not.toBe('none')
  input.focus()
  input.setSelectionRange(0, 8)
  expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe('Selected')
  host.querySelector('button')!.focus()
  expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe('Selected')
})
