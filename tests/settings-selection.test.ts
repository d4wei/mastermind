// @vitest-environment jsdom
/// <reference lib="dom" />
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('keeps settings chrome nonselectable while preserving editable and document text', () => {
  const style = document.createElement('style')
  style.textContent = fs.readFileSync(path.join(__dirname, '../src/ui/app/app.css'), 'utf8')
  document.head.append(style)
  const host = document.createElement('div')
  host.innerHTML = `
    <div class="slide-over" id="settings">
      <div class="slide-over-title">Settings</div>
      <div class="settings-body">
        <span>Author tag</span><input type="text" value="alex">
        <input type="search" value="English"><textarea>Editable text</textarea>
      </div>
    </div>
    <div class="slide-over" id="other">Another panel</div>
    <article class="md-root">Document text</article>`
  document.body.append(host)
  try {
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
  } finally {
    host.remove()
    style.remove()
  }
})
