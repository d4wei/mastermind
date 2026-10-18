// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { analyzeMarkdown } from '../document/markdown/analyze'
import { FindBar } from '../ui/review/FindBar'

it('clears search emphasis when no result remains and when Find closes', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const source = '{>>@Alex: Find this note<<}'
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function Harness({ open = true }: { open?: boolean }) {
    const docRef = useRef<HTMLElement>(null)
    return <><article ref={docRef}><span data-span-index="0">note</span></article>
      {open && <FindBar analysis={analyzeMarkdown(source)} source={source} docRef={docRef} onClose={() => {}} />}</>
  }
  try {
    act(() => root.render(<Harness />))
    expect(host.querySelector('.find-match')).not.toBeNull()
    const input = host.querySelector('input')!
    expect(document.activeElement).toBe(input)
    const fill = (value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    fill('absent')
    expect(host.querySelector('.find-match')).toBeNull()
    fill('note')
    expect(host.querySelector('.find-match')).not.toBeNull()
    act(() => root.render(<Harness open={false} />))
    expect(host.querySelector('.find-match')).toBeNull()
  } finally {
    act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})
