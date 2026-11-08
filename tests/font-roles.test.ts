// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { afterEach, expect, it } from 'vitest'

// Reading presets set the document faces; interface chrome keeps the system face whatever the preset.
const READING_FACES = /var\(--font-(body|display)\)/
/** Selectors whose elements render document text: the Markdown body and quotations of it. */
const DOCUMENT_TEXT = /^(\.md-root\b|\.trans-view \.md-callout\b|\.translated-comment-quote$|\.resolved-quote$)/

const uiRoot = path.resolve('ui')
const sheets = readdirSync(uiRoot, { recursive: true }).map(String).filter((name) => name.endsWith('.css'))
  .map((name) => ({ name, css: readFileSync(path.join(uiRoot, name), 'utf8') }))

afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren() })

it('gives the reading faces only to selectors that render document text', () => {
  const offenders: string[] = []
  for (const { name, css } of sheets) {
    postcss.parse(css).walkDecls(/^font(-family)?$/, (decl) => {
      if (!READING_FACES.test(decl.value) || decl.parent?.type !== 'rule') return
      for (const selector of decl.parent.selectors) if (!DOCUMENT_TEXT.test(selector)) offenders.push(`${name}: ${selector}`)
    })
  }
  expect(offenders).toEqual([])
})

it('resolves interface controls to the UI face and document text to the reading face', () => {
  const style = document.createElement('style')
  style.textContent = sheets.map(({ css }) => css).join('\n')
  document.head.append(style)
  document.body.innerHTML = `
    <div class="find-bar"><input class="settings-input find-input"></div>
    <div class="reader-menu"><div class="reader-menu-item">Delete comment</div></div>
    <div class="slide-over"><span class="slide-over-title">Resolved</span></div>
    <div class="sel-toolbar"><button>Comment</button><div class="sel-composer"><textarea></textarea>
      <div class="sel-composer-actions"><button class="btn-compact">Cancel</button><button class="btn-primary btn-compact">Suggest change</button></div></div></div>
    <div class="rail-card"><span class="rail-author">Alex</span><div class="rail-body">note</div>
      <div class="rail-reply"><textarea></textarea></div></div>
    <article class="resolved-card"><blockquote class="resolved-quote">passage</blockquote></article>
    <article class="md-root"><p>prose</p><button class="md-table-toggle">expand</button></article>`
  const family = (selector: string) => getComputedStyle(document.querySelector(selector)!).fontFamily
  expect(family('body')).toBe('var(--font-ui)')
  for (const control of ['button', 'input', 'textarea', '.sel-composer textarea', '.rail-reply textarea',
    '.btn-primary', '.md-table-toggle', '.rail-card']) {
    expect(family(control), control).toBe('var(--font-ui)')
  }
  expect(family('.md-root')).toBe('var(--font-body)')
  expect(family('.resolved-quote')).toBe('var(--font-body)')
})
