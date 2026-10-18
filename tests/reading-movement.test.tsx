// @vitest-environment jsdom
import { act } from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createReactHost, removeReactHost } from './helpers/dom'
import { useReadingMovement } from '../ui/app/useReadingSpace'
let view: ReturnType<typeof createReactHost>
const cancel = vi.fn(), animate = vi.fn(() => ({ cancel }))
let reduced = false
function Movement({ left, rail }: { left: number; rail: boolean }) {
  useReadingMovement(view.host, left, rail)
  return <div className="doc-column" ref={(el) => { if (el) Object.assign(el, { animate }) }} />
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  view = createReactHost()
  Object.assign(view.host, { animate })
  view.host.style.setProperty('--dur-base', '180ms')
  view.host.style.setProperty('--ease-out', 'ease-out')
  reduced = false; animate.mockClear(); cancel.mockClear()
})
afterEach(() => { removeReactHost(view.root, view.host); vi.unstubAllGlobals() })
it('moves only the document column when comment visibility changes', () => {
  act(() => view.root.render(<Movement left={300} rail={false} />))
  expect(animate).not.toHaveBeenCalled()
  act(() => view.root.render(<Movement left={140} rail />))
  expect(animate).toHaveBeenCalledWith([
    { transform: 'translateX(160px)' }, { transform: 'translateX(0)' },
  ], { duration: 180, easing: 'ease-out' })
  act(() => view.root.render(<Movement left={100} rail />))
  expect(cancel).toHaveBeenCalled()
  expect(animate).toHaveBeenCalledOnce()
})
it('does not animate reduced motion or unchanged document positions', () => {
  act(() => view.root.render(<Movement left={300} rail={false} />))
  act(() => view.root.render(<Movement left={300} rail />))
  expect(animate).not.toHaveBeenCalled()
  reduced = true
  act(() => view.root.render(<Movement left={200} rail={false} />))
  expect(animate).not.toHaveBeenCalled()
})
