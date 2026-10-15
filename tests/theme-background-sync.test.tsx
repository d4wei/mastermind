// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ThemeEffects } from '../ui/theme/ThemeProvider'
import { syncHostBackground } from '../ui/theme/background'
import { useConfig } from '../ui/app/configStore'
import { installHost } from '../ui/app/host'
import { fakeHost } from './helpers/host'
import { DEFAULT_CONFIG } from '../ui/settings/defaults'

let root: Root
let host: HTMLDivElement
let channels: number[]
const setBackgroundColor = vi.fn()
let context: { fillStyle: string; fillRect: ReturnType<typeof vi.fn>; getImageData: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0 })
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.backgroundColor = 'rgb(40, 42, 54)'
  channels = [40, 42, 54, 255]
  context = { fillStyle: '', fillRect: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(channels) })) }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  setBackgroundColor.mockReset().mockResolvedValue(undefined)
  installHost(fakeHost({ setBackgroundColor }))
  useConfig.setState({ config: { ...DEFAULT_CONFIG, theme: 'grid' }, themes: [] })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.head.replaceChildren()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  installHost(null)
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const tokens = () => document.querySelector<HTMLLinkElement>('#theme-tokens')!

it('sends the rendered background after stylesheet load and each theme switch', () => {
  act(() => root.render(<ThemeEffects />))
  expect(setBackgroundColor).not.toHaveBeenCalled()
  act(() => tokens().dispatchEvent(new Event('load')))
  expect(context.fillStyle).toBe('rgb(40, 42, 54)')
  expect(setBackgroundColor).toHaveBeenLastCalledWith([40, 42, 54, 255])
  act(() => useConfig.setState({ config: { ...DEFAULT_CONFIG, theme: 'sepia' } }))
  channels = [242, 236, 223, 255]
  document.documentElement.style.backgroundColor = 'rgb(242, 236, 223)'
  act(() => vi.advanceTimersByTime(300))
  expect(setBackgroundColor).toHaveBeenCalledTimes(1)
  act(() => tokens().dispatchEvent(new Event('load')))
  expect(context.fillStyle).toBe('rgb(242, 236, 223)')
  expect(setBackgroundColor).toHaveBeenLastCalledWith([242, 236, 223, 255])
  act(() => root.render(null))
  tokens().dispatchEvent(new Event('load'))
  expect(setBackgroundColor).toHaveBeenCalledTimes(2)
})

it('synchronizes an already-loaded startup stylesheet without waiting for another load', () => {
  const link = document.createElement('link')
  link.id = 'theme-tokens'
  link.href = '/themes/grid/tokens.css'
  Object.defineProperty(link, 'sheet', { value: {} })
  document.head.append(link)
  document.documentElement.dataset.theme = 'grid'
  act(() => root.render(<ThemeEffects />))
  expect(setBackgroundColor).toHaveBeenCalledWith([40, 42, 54, 255])
})

it('does no native work for hosts without a native background surface', () => {
  installHost(fakeHost())
  syncHostBackground()
  expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled()
  expect(setBackgroundColor).not.toHaveBeenCalled()
})
