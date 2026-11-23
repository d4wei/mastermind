// @vitest-environment jsdom
import { act, useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { useOverlay, useOverlayControl } from '../ui/app/overlayStore'
import { useCompositionGuard } from '../ui/util/composition'
import { createReactHost, removeReactHost } from './helpers/dom'

// Effects list these values as dependencies, so a new identity per render would resubscribe them.
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  vi.unstubAllGlobals()
})

it('keeps the composition guard and an overlay setter stable across renders', () => {
  const guards: unknown[] = []
  const setters: unknown[] = []
  let rerender = () => {}
  function Probe() {
    const [, setCount] = useState(0)
    rerender = () => setCount((count) => count + 1)
    guards.push(useCompositionGuard())
    setters.push(useOverlayControl('files')[1])
    return null
  }
  act(() => { root.render(<Probe />) })
  act(() => { rerender() })
  expect(guards).toHaveLength(2)
  expect(guards[1]).toBe(guards[0])
  expect(setters[1]).toBe(setters[0])
  act(() => { (setters[1] as (next: boolean) => void)(true) })
  expect(useOverlay.getState().open).toBe('files')
})
