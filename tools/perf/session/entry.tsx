// Mounts SessionView in a real browser on the mid and large fixtures and times the interactions the
// reading surface answers synchronously. Runs inside the page built by run.mjs; writes its results
// as JSON into <pre id="results"> for the CDP driver to read.
import '../../../ui/app/app.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Profiler } from 'react'
import { Tooltip } from 'radix-ui'
import { EditorView } from '@codemirror/view'
import { installHost } from '../../../ui/app/host'
import { useDoc } from '../../../ui/documents/store'
import { SessionView } from '../../../ui/app/SessionView'
import { requestFind } from '../../../ui/app/overlayStore'
import { TableExpansionProvider } from '../../../ui/modes/reading/TableExpansion'
import { mapSelection } from '../../../ui/modes/reading/selection'
import { analyzeMarkdown } from '../../../document/markdown/analyze'
import { fakeHost } from '../../../tests/helpers/host'

declare const COMMIT: string
declare global { interface Window { FIXTURE_MID: string, FIXTURE_LARGE: string } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!
const out: Record<string, Record<string, string>> = {}
let commits = 0, actual = 0

async function run(name: string, source: string) {
  const r: Record<string, string> = {}
  out[name] = r
  const put = (k: string, v: number) => { r[k] = v.toFixed(1) }
  // A session that never loads: the store below is the only document source.
  installHost(fakeHost({ getSession: () => new Promise(() => {}) }))
  useDoc.setState({ sessionId: 'A', status: 'ready', source, savedSource: source, load: async () => {}, meta: null, mode: 'reading' } as never)
  const host = document.createElement('div')
  host.id = 'root'
  host.className = 'app-content'
  document.body.append(host)
  const root = createRoot(host)
  const onRender = (_id: string, _phase: string, duration: number) => { commits++; actual += duration }
  // sync: the flushSync'd update. +layout: forced style and layout. profiler actual: React render
  // time including deferred updates that land within `settleMs` and three further tasks.
  const step = async (label: string, fn: () => void, settleMs = 0) => {
    commits = 0; actual = 0
    const t0 = performance.now(); flushSync(fn); const t1 = performance.now()
    void document.body.offsetHeight; const t2 = performance.now()
    await sleep(settleMs); await sleep(0); await sleep(0)
    put(`${label}: sync ms`, t1 - t0); put(`${label}: +layout ms`, t2 - t1)
    put(`${label}: profiler actual incl. deferred ms`, actual); r[`${label}: commits`] = String(commits)
  }

  await step('mount', () => root.render(
    <Profiler id="session" onRender={onRender}><Tooltip.Provider><TableExpansionProvider><SessionView sessionId="A" /></TableExpansionProvider></Tooltip.Provider></Profiler>,
  ), 50)
  r['DOM elements'] = String(host.getElementsByTagName('*').length)
  r['rail cards'] = String(host.querySelectorAll('.rail-card').length)
  const article = host.querySelector('article.md-root')!
  const anchors = article.querySelectorAll('.critic-anchor')

  const idle: number[] = []
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); await sleep(0); idle.push(performance.now() - t0) }
  const hovers: number[] = [], hoverActual: number[] = []
  for (let i = 0; i < 6; i++) {
    actual = 0
    const t0 = performance.now()
    anchors[i * 3]!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    await sleep(0)
    hovers.push(performance.now() - t0); hoverActual.push(actual)
  }
  put('hover anchor: dispatch..next task ms (median of 6)', med(hovers))
  put('  idle setTimeout(0) baseline ms', med(idle))
  put('hover anchor: profiler actual ms (median)', med(hoverActual))

  await step('click anchor (select thread)', () => (anchors[4] as HTMLElement).click(), 20)
  const reply = host.querySelector<HTMLTextAreaElement>('.rail-card.active textarea')
  if (reply) {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    let text = ''
    for (const ch of ['O', 'K']) {
      text += ch
      const t0 = performance.now()
      flushSync(() => { setValue.call(reply, text); reply.dispatchEvent(new Event('input', { bubbles: true })) })
      const t1 = performance.now()
      await sleep(0); await sleep(0); await sleep(0)
      put(`reply keystroke "${text}": urgent sync ms`, t1 - t0)
      put(`reply keystroke "${text}": until deferred verdict done ms`, performance.now() - t0)
    }
  } else r['reply'] = 'no composer'
  await step('Escape', () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

  const analysis = analyzeMarkdown(source)
  const range = document.createRange()
  range.selectNodeContents(article.querySelectorAll('p')[10]!)
  const ms: number[] = []
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); mapSelection(range, source, analysis, article); ms.push(performance.now() - t0) }
  put('mapSelection one paragraph (first call builds index) ms', ms[0]!)
  put('mapSelection warm ms', med(ms.slice(1)))

  requestFind(); await sleep(50); await sleep(0)
  const input = document.querySelector<HTMLInputElement>('.find-input')
  if (input) {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    for (const q of ['r', 're', 'rev', 'revi', 'review']) {
      await step(`Find keystroke "${q}"`, () => { setValue.call(input, q); input.dispatchEvent(new Event('input', { bubbles: true })) })
    }
    await step('Find close', () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  } else r['find'] = 'no input'

  await step('click deletion (review edit)', () => article.querySelector<HTMLElement>('.critic-del')!.click())
  await step('undo', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true })))
  await step('mode -> Markdown', () => useDoc.getState().setMode('source'), 300)
  const cm = host.querySelector<HTMLElement>('.cm-content')
  const view = cm && EditorView.findFromDOM(cm)
  if (view) {
    const ks: number[] = []
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      flushSync(() => view.dispatch({ changes: { from: 40, insert: 'x' }, userEvent: 'input.type' }))
      await sleep(0)
      ks.push(performance.now() - t0)
    }
    put('Markdown-mode keystroke (dispatch + store + React + next task) ms median of 3', med(ks))
  } else r['cm'] = 'no editor'
  await step('mode -> Read', () => useDoc.getState().setMode('reading'), 50)
  await step('mode -> Markdown (unchanged source)', () => useDoc.getState().setMode('source'), 300)
  await step('mode -> Read (unchanged source)', () => useDoc.getState().setMode('reading'), 50)
  root.unmount()
  host.remove()
}

void (async () => {
  try {
    await run('mid', window.FIXTURE_MID)
    await run('large', window.FIXTURE_LARGE)
  } catch (e) {
    out.error = { stack: String((e as Error).stack) }
  }
  const pre = document.createElement('pre')
  pre.id = 'results'
  pre.textContent = JSON.stringify({ commit: COMMIT, ...out })
  document.body.append(pre)
})()
