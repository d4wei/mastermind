// Builds entry.tsx as a production bundle with React's profiling build, loads it with the mid and
// large fixtures in headless Chrome, and prints the page's results. Run with `npm run perf:session`.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { ensureFixture } from '../fixtures.mjs'

const here = import.meta.dirname
const repo = join(here, '../../..')
const outDir = join(here, '../.build/session')
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() +
  (execFileSync('git', ['status', '--porcelain', '--', 'ui', 'document'], { cwd: repo, encoding: 'utf8' }).trim() ? '+dirty' : '')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) {
  console.error('No Chrome found. Install Google Chrome or set CHROME_PATH to a Chrome or Chromium binary.')
  process.exit(1)
}

await build({
  configFile: false,
  root: here,
  logLevel: 'warn',
  plugins: [react()],
  // react-dom/profiling keeps <Profiler> durations in a production build.
  resolve: { alias: [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] },
  define: { 'process.env.NODE_ENV': '"production"', COMMIT: JSON.stringify(commit) },
  build: {
    outDir, emptyOutDir: true, minify: true, cssMinify: false, cssCodeSplit: false,
    lib: { entry: join(here, 'entry.tsx'), formats: ['iife'], name: 'bench', fileName: () => 'bench.js', cssFileName: 'bench' },
  },
})

const fixtureScript = ['mid', 'large']
  .map((n) => `window.FIXTURE_${n.toUpperCase()}=${JSON.stringify(readFileSync(ensureFixture(`${n}.md`), 'utf8'))};`).join('\n')
writeFileSync(join(outDir, 'fixtures.js'), fixtureScript)
const theme = (file) => pathToFileURL(join(repo, 'themes', file)).href
writeFileSync(join(outDir, 'bench.html'), `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${theme('grid/tokens.css')}">
<link rel="stylesheet" href="${theme('common.css')}">
<link rel="stylesheet" href="${theme('fonts/faces.css')}">
<link rel="stylesheet" href="bench.css">
</head><body><script src="fixtures.js"></script><script src="bench.js"></script></body></html>`)

const profile = mkdtempSync(join(tmpdir(), 'mm-perf-chrome-'))
const port = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
  '--allow-file-access-from-files', '--window-size=1400,1000', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let targets
  for (let i = 0; i < 50 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json() } catch { await sleep(200) }
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable')
  await send('Page.navigate', { url: pathToFileURL(join(outDir, 'bench.html')).href })
  let text = ''
  for (const start = Date.now(); !text && Date.now() - start < 600_000;) {
    await sleep(1000)
    const r = await send('Runtime.evaluate', { expression: "document.getElementById('results')?.textContent ?? ''", returnByValue: true })
    text = r.result?.result?.value ?? ''
  }
  ws.close()
  if (!text) throw new Error('page produced no results within 10 minutes')
  const results = JSON.parse(text)
  const resultsDir = join(here, '../results')
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(join(resultsDir, `session-${commit}.json`), JSON.stringify(results, null, 1))
  if (results.error) { console.error(results.error.stack); process.exitCode = 1 }
  const rows = {}
  for (const fixture of ['mid', 'large']) for (const [k, v] of Object.entries(results[fixture] ?? {})) (rows[k] ??= {})[fixture] = v
  console.log(`commit ${commit}`)
  console.table(rows)
} finally {
  const exited = new Promise((r) => chrome.once('exit', r))
  chrome.kill()
  await exited
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
