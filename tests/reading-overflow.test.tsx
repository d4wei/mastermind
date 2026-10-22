// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderMarkdown } from './helpers/markdown'
import { MarkdownView } from '../ui/modes/reading/Renderer'
import { analyzeMarkdown } from '../document/markdown/analyze'

afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren() })

it('contains table overflow in a keyboard-accessible region while retaining source anchors', () => {
  const source = '# Heading\n\n| Key | Value |\n| --- | --- |\n| identifier | `very_long_identifier_without_breaks` |\n'
  const { host } = renderMarkdown(source)
  const style = document.createElement('style')
  style.textContent = readFileSync('ui/app/app.css', 'utf8')
  document.head.append(style); document.body.append(host)
  const region = host.querySelector<HTMLElement>('.md-table-scroll')!
  expect(region.getAttribute('role')).toBe('region')
  expect(region.getAttribute('aria-label')).toBe('Table')
  expect(region.tabIndex).toBe(0)
  expect(getComputedStyle(region).overflowX).toBe('auto')
  expect(getComputedStyle(region).maxWidth).toBe('100%')
  const table = region.querySelector('table')!
  expect(table.querySelectorAll('th')).toHaveLength(2)
  expect(table.querySelectorAll('td')).toHaveLength(2)
  expect(table.getAttribute('data-ps')).toBe(String(source.indexOf('| Key')))
  const cell = table.querySelectorAll('td')[1]!
  expect(source.slice(Number(cell.getAttribute('data-ps')), Number(cell.getAttribute('data-pe'))))
    .toContain('`very_long_identifier_without_breaks`')
})

it('passes explicit fence languages to coloring without guessing for plain or unsupported blocks', () => {
  const source = '```TypeScript\nconst count = 3\n```\n\n```yaml\ncount: 3 # note\n```\n\n```\nreturn "hello"\n```'
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<MarkdownView analysis={analyzeMarkdown(source)} ctx={{ source, highlightCode: true }} />)
  const blocks = host.querySelectorAll('pre')
  expect(blocks[0]!.querySelector('.tok-keyword')?.textContent).toBe('const')
  expect(blocks[1]!.querySelector('.tok')).toBeNull()
  expect(blocks[1]!.textContent).toBe('count: 3 # note')
  expect(blocks[2]!.querySelector('.tok')).toBeNull()
  expect(blocks[2]!.textContent).toBe('return "hello"')
})
