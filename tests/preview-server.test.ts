import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { previewArguments } from '../tools/preview/arguments'
import { startPreview, type RunningPreview } from '../tools/preview/server'

let dir: string
let preview: RunningPreview | undefined
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mm-preview-server-')))
  await fs.writeFile(path.join(dir, 'doc.md'), 'original\n')
})
afterEach(async () => {
  await preview?.close()
  preview = undefined
  await fs.rm(dir, { recursive: true, force: true })
})

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    }).on('error', reject)
  })
}

it('refuses another local origin on the proxied API and its preflight', async () => {
  preview = await startPreview(path.join(dir, 'doc.md'), 0, await freePort())
  const origin = new URL(preview.url).origin
  const api = `${origin}/api/sessions/preview/file`
  const foreign = { origin: 'http://localhost:3000' }
  const preflight = await fetch(api, { method: 'OPTIONS', headers: {
    ...foreign, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' } })
  expect(preflight.status).toBe(403)
  expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  const read = await fetch(api, { headers: foreign })
  expect(read.status).toBe(403)
  expect(read.headers.get('access-control-allow-origin')).toBeNull()
  const own = await fetch(api, { headers: { origin } })
  expect(own.status).toBe(200)
  expect((await own.json() as { content: string }).content).toBe('original\n')
}, 20_000)

it('resolves the file from the invoking directory and themes from the repository', async () => {
  const child = spawn(process.execPath, ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href, path.resolve('tools/preview/index.ts'), 'doc.md',
    '--port', String(await freePort())], { cwd: os.tmpdir(), env: { ...process.env, INIT_CWD: dir, npm_lifecycle_event: 'dev' }, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error(`preview did not start: ${output}`)), 15_000)
      const read = (chunk: Buffer) => {
        output += chunk.toString()
        const match = /Development preview: (\S+)/.exec(output)
        if (match) { clearTimeout(timer); resolve(match[1]!) }
      }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
      child.on('exit', () => { clearTimeout(timer); reject(new Error(`preview exited: ${output}`)) })
    })
    const origin = new URL(url).origin
    const session = await (await fetch(`${origin}/api/sessions/preview`)).json() as { path: string }
    expect(session.path).toBe(path.join(dir, 'doc.md'))
    const themes = await (await fetch(`${origin}/api/themes`)).json() as Array<{ id: string }>
    expect(themes.map(({ id }) => id)).toContain('grid')
  } finally {
    child.kill('SIGTERM')
  }
}, 20_000)

it('resolves a relative file against INIT_CWD only when npm started the script', () => {
  const env = { INIT_CWD: '/stale' }
  expect(previewArguments(['doc.md'], env, '/here')).toEqual({ file: path.resolve('/here', 'doc.md'), port: 5199 })
  expect(previewArguments(['doc.md', '--port', '6000'], { ...env, npm_lifecycle_event: 'dev' }, '/here'))
    .toEqual({ file: path.resolve('/stale', 'doc.md'), port: 6000 })
})
