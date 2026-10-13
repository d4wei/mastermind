import { expect, it } from 'vitest'
import { parseRoute } from '../src/ui/app/route-parse'

it('opens native documents and the development preview', () => {
  expect(parseRoute('/d/12')).toEqual({ kind: 'doc', sessionId: '12' })
  expect(parseRoute('/d/preview')).toEqual({ kind: 'doc', sessionId: 'preview' })
})
it('rejects retired workspace routes and document suffixes', () => {
  for (const path of ['/', '/w/12', '/w/12/d/13', '/d/12/unexpected']) {
    expect(parseRoute(path)).toEqual({ kind: 'home' })
  }
})
