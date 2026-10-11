// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('uses contrasting inverted tokens for composer selection and retains native input ranges', () => {
  const style = document.createElement('style')
  style.textContent = readFileSync(path.join(__dirname, '../src/ui/app/app.css'), 'utf8')
  document.head.append(style)
  const host = document.createElement('div')
  host.className = 'sel-composer'
  host.innerHTML = '<textarea>Selected comment text</textarea><button>Blur</button>'
  document.body.append(host)
  try {
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
  } finally {
    host.remove()
    style.remove()
  }
})
