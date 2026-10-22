// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileTabs, type OpenDocument } from '../ui/desktop/FileTabs'
import { useClosePrompt } from '../ui/desktop/CloseDialog'

let host: HTMLDivElement
let root: Root
let width: number
let pillWidths: number[]
let resize: () => void
let files: OpenDocument[]
let select = vi.fn<(id: string) => void>()
let close = vi.fn<(id: string) => void>()
let blocked: boolean
let chinese: boolean
beforeEach(() => {
  width = 400; pillWidths = []; blocked = false; chinese = false
  files = Array.from({ length: 12 }, (_,i) => ({ id: String(i), path: `/folder-${i}/review.md` }))
  select = vi.fn(); close = vi.fn()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: () => void) {} observe(element: HTMLElement) { if (element.classList.contains('native-file-pills')) resize = this.callback } unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.classList.contains('native-file-pills') ? width : this.classList.contains('native-file-size') ? pillWidths[[...this.parentElement!.querySelectorAll('.native-file-size')].indexOf(this)] ?? 160 : 50,
      height: 30, top: 0, left: 0, right: 400, bottom: 30, x: 0, y: 0, toJSON: () => ({}) }
  })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useClosePrompt.setState({ prompt: null }); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function Harness() {
  const [list, setList] = useState(files)
  const [active, setActive] = useState('0')
  return <FileTabs files={list} activeId={active} chinese={chinese} needsAttention={(id) => id === '4'}
    onAttention={() => {}} onSelect={(id) => { select(id); setActive(id) }} onClose={async (file) => {
      close(file.id)
      if (blocked) return false
      setList((old) => old.filter((item) => item.id !== file.id))
      if (file.id === active) setActive(list.find((item) => item.id !== file.id)!.id)
      return true
    }} />
}
async function mount() { await act(async () => root.render(<Harness />)) }
async function open() { await act(async () => host.querySelector<HTMLButtonElement>('button.native-file-overflow')!.click()) }
const menu = () => document.querySelector<HTMLElement>('.native-file-list')!
const rows = () => [...menu().querySelectorAll<HTMLElement>('.native-file-entry')]

it('lists all files without search or checkmarks, preserving disambiguated names and paths', async () => {
  await mount(); await open()
  expect(rows()).toHaveLength(12)
  expect(menu().querySelector('input')).toBeNull()
  expect(menu().querySelector('button button')).toBeNull()
  expect(rows()[0]!.querySelector('.native-file-select')!.textContent).toBe('folder-0/review.md')
  expect(rows()[0]!.querySelector('button')!.title).toBe('/folder-0/review.md')
  expect(rows()[0]!.classList.contains('active')).toBe(true)
  expect(rows()[0]!.querySelectorAll('svg')).toHaveLength(1)
  expect(document.activeElement).toBe(rows()[0]!.querySelector('button'))
})
it('selects a hidden file, dismisses the list, and keeps it visible through resize', async () => {
  await mount(); await open()
  await act(async () => rows()[11]!.querySelector<HTMLButtonElement>('.native-file-select')!.click())
  expect(menu()).toBeNull()
  expect(select).toHaveBeenLastCalledWith('11')
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('folder-11/review.md')
  await act(async () => { width = 180; resize() })
  expect(host.querySelectorAll('.native-file-pill')).toHaveLength(1)
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('folder-11/review.md')
})
it.each([0, 5])('closes row %i without selecting it or dismissing the list, and focuses the next close', async (index) => {
  await mount(); await open()
  await act(async () => rows()[index]!.querySelector<HTMLButtonElement>('.native-file-close')!.click())
  expect(close).toHaveBeenCalledWith(String(index))
  expect(select).not.toHaveBeenCalled()
  expect(rows()).toHaveLength(11)
  expect(document.activeElement).toBe(rows()[index]!.querySelector('.native-file-close'))
})
it('retains a blocked close and removes the list before a close confirmation', async () => {
  blocked = true
  await mount(); await open()
  await act(async () => rows()[3]!.querySelector<HTMLButtonElement>('.native-file-close')!.click())
  expect(rows()).toHaveLength(12)
  await act(async () => useClosePrompt.setState({ prompt: { kind: 'draft', names: ['review.md'] } }))
  expect(menu()).toBeNull()
})
it('navigates the whole list by keyboard and returns focus on Escape', async () => {
  await mount(); await open()
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
  expect(document.activeElement).toBe(rows()[11]!.querySelector('button'))
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
  expect(document.activeElement).toBe(rows()[0]!.querySelector('button'))
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(menu()).toBeNull()
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('button.native-file-overflow')))
})
it('closes Find on opening the list and closes the list on a Find request', async () => {
  const listener = vi.fn(); window.addEventListener('mastermind-find-close', listener)
  try {
    await mount(); await open(); expect(listener).toHaveBeenCalledTimes(1)
    await act(async () => window.dispatchEvent(new Event('mastermind-find')))
    expect(menu()).toBeNull()
  } finally { window.removeEventListener('mastermind-find-close', listener) }
})
it('labels the list and close controls in Chinese', async () => {
  chinese = true
  await mount(); await open()
  expect(menu().getAttribute('aria-label')).toBe('打开的文件')
  expect(rows()[0]!.querySelector('.native-file-close')!.getAttribute('aria-label')).toBe('关闭 folder-0/review.md')
})

it('fits short labels by their measured widths and recomputes when they grow', async () => {
  files = files.slice(0, 3)
  pillWidths = [90, 100, 110]
  width = 320
  await mount()
  expect(host.querySelectorAll('.native-file-pill')).toHaveLength(3)
  expect(host.querySelector('button.native-file-overflow')).toBeNull()
  expect(host.querySelector('.native-file-measure button')).toBeNull()
  await act(async () => { pillWidths = [160, 160, 160]; resize() })
  expect(host.querySelectorAll('.native-file-pill')).toHaveLength(1)
  expect(host.querySelector('button.native-file-overflow')?.textContent).toContain('+2')
})

it('dismisses the file list when the language menu opens', async () => {
  await mount(); await open()
  await act(async () => window.dispatchEvent(new Event('mastermind-language-open')))
  expect(menu()).toBeNull()
})

it('accepts further closes when the next file never becomes active', async () => {
  const closed: string[] = []
  function Unloaded() {
    const [list, setList] = useState(files.slice(0, 3))
    const [active, setActive] = useState<string | null>('0')
    return <FileTabs files={list} activeId={active} chinese={false} needsAttention={() => false}
      onSelect={() => {}} onAttention={() => {}} onClose={async (file) => {
        closed.push(file.id)
        setList((old) => old.filter((item) => item.id !== file.id))
        setActive(null)
        return true
      }} />
  }
  await act(async () => root.render(<Unloaded />))
  const closeButton = (id: string) => host.querySelector<HTMLButtonElement>(
    `.native-file-pill .native-file-close[title="Close /folder-${id}/review.md"]`)!
  await act(async () => closeButton('0').click())
  await act(async () => closeButton('1').click())
  await act(async () => closeButton('2').click())
  expect(closed).toEqual(['0', '1', '2'])
})
