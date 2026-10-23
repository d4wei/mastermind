import { expect, it } from 'vitest'
import { parseRoute } from '../ui/app/route'

it('opens native documents', () => {
  expect(parseRoute('/d/12')).toEqual({ kind: 'doc', sessionId: '12' })
})
it('rejects retired workspace and preview routes and document suffixes', () => {
  for (const path of ['/', '/w/12', '/w/12/d/13', '/d/12/unexpected', '/d/preview']) {
    expect(parseRoute(path)).toEqual({ kind: 'home' })
  }
})
