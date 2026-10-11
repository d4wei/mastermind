// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { CommentBody } from '../src/ui/review/CommentBody'

it.each([
  ['one\ntwo', 'one two'],
  ['one\r\ntwo', 'one two'],
  ['one \n  two\n\nthree\n four', 'one two\n\nthree four'],
  ['one\r\n \r\ntwo', 'one\n\ntwo'],
  ['中文\n评论', '中文 评论'],
  ['literal <tag> & punctuation', 'literal <tag> & punctuation'],
])('renders comment prose %j while preserving its input', (body, expected) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  const original = body
  try {
    act(() => root.render(<CommentBody body={body} />))
    expect(host.querySelector('.rail-body')!.textContent).toBe(expected)
    expect(body).toBe(original)
    expect(host.querySelector('tag')).toBeNull()
  } finally {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  }
})
