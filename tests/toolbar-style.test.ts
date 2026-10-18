// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps generic button padding from squeezing the document toolbar icons', () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('ui/app/app.css', 'utf8')
  const button = document.createElement('button')
  button.className = 'btn-ghost btn-icon topbar-icon-btn'
  document.head.append(style); document.body.append(button)
  try {
    const computed = getComputedStyle(button)
    expect(computed.paddingLeft).toBe('0px')
    expect(computed.paddingRight).toBe('0px')
    expect(computed.paddingTop).toBe('0px')
    expect(computed.paddingBottom).toBe('0px')
  } finally { button.remove(); style.remove() }
})
