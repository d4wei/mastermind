// @vitest-environment jsdom
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createReactHost, removeReactHost } from './helpers/dom'
import { Frontmatter, loadMetadataParser, metadataProperties } from '../ui/modes/reading/Frontmatter'

let host: HTMLDivElement
let root: ReturnType<typeof createReactHost>['root']
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  ;({ host, root } = createReactHost())
})
afterEach(() => { removeReactHost(root, host); vi.unstubAllGlobals() })

// Module state persists across this file's tests, so the order below is the loading order.
it('holds the likely display space, hidden from reading, until the metadata parser loads', async () => {
  expect(metadataProperties('title: Plan')).toBeUndefined()
  expect(metadataProperties('description: ' + 'x'.repeat(64 * 1024))).toBeNull()
  const markup = (source: string) => {
    const element = document.createElement('div'); element.innerHTML = renderToStaticMarkup(<Frontmatter source={source} />)
    return element.firstElementChild!
  }
  const pending = markup('# owner notes\ntitle: "Plan"\nstatus: draft')
  expect(pending.className).toBe('md-frontmatter md-frontmatter-pending')
  expect(pending.getAttribute('aria-hidden')).toBe('true')
  expect([...pending.querySelectorAll('dt')].map((node) => node.textContent)).toEqual(['title', 'status'])
  expect(markup('items:\n  - one').querySelector('pre')?.textContent).toBe('items:\n  - one')
  expect(markup('tags: [a, b]').querySelector('dl')).toBeNull()

  await act(async () => root.render(<Frontmatter source={'title: "Plan"\nstatus: draft'} />))
  await act(async () => { await loadMetadataParser() })
  const shown = host.querySelector('.md-frontmatter')!
  expect(shown.className).toBe('md-frontmatter')
  expect(shown.hasAttribute('aria-hidden')).toBe(false)
  expect([...shown.querySelectorAll('.md-property')].map((row) => row.textContent)).toEqual(['titlePlan', 'statusdraft'])
})
